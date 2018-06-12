const ipfs = window.ipfs
const localStorage = window.localStorage
const sessionStorage = window.sessionStorage
const graphlib = require('graphlib')
const CID = require('cids')
const render = require('react-dom').render
const React = require('react')
const h = require('react-hyperscript')


const nonDirBlocks = JSON.parse(localStorage.getItem('non-dir-blocks') || '{}')
const dirBlocks = JSON.parse(sessionStorage.getItem('dir-blocks') || '{}')
const g = window.g = new graphlib.Graph()

class App extends React.Component {
  constructor (props) {
    super(props)

    this.state = {
      log: [],
      logIndex: 1,
      npins: null,
      sources: []
    }
  }

  async componentDidMount () {
    this.log('reading all pinned refs')
    let pins = await ipfs.pin.ls()
    this.log(`got ${pins.length} refs`)

    this.setState({npins: pins.length})

    for (let i = 0; i < pins.length; i++) {
      let {hash} = pins[i]
      await this.checkDirectory(hash)
    }

    this.log('finished reading refs')

    this.setState(st => {
      st.sources = g.sources()
      return st
    })
  }

  log (message) {
    this.setState(st => {
      st.log.unshift(`${st.logIndex}: ${message}`)
      st.log = st.log.slice(0, 50)
      st.logIndex++
      return st
    })
  }

  async checkDirectory (ref) {
    if (nonDirBlocks[ref]) {
      return
    }

    let cid = new CID(ref)

    if (cid.codec !== 'dag-pb' && cid.codec !== 'dag-cbor') {
      return
    }

    this.log(`fetching ${ref}`)
    try {
      let o = dirBlocks[ref] || (await ipfs.object.get(ref))._json
      if (o.links[0] && o.links[0].name) {
        g.setNode(o.multihash)
        o.links.forEach(l => {
          g.setNode(l.multihash)
          g.setEdge(o.multihash, l.multihash, {name: l.name, size: l.size})
        })

        dirBlocks[ref] = o
        sessionStorage.setItem('dir-blocks', JSON.stringify(dirBlocks))
      } else {
        nonDirBlocks[ref] = 1
        localStorage.setItem('non-dir-blocks', JSON.stringify(nonDirBlocks))
      }
    } catch (err) {
      console.error(err)
    }
  }

  render () {
    return [
      h('#stats', {key: 'stats'}, [
        h('table', [
          h('tbody', [
            h('tr', [
              h('th', 'pinned refs: '),
              h('td', this.state.npins)
            ]),
            h('tr', [
              h('th', 'node count: '),
              h('td', g.nodeCount())
            ]),
            h('tr', [
              h('th', 'edge count: '),
              h('td', g.edgeCount())
            ])
          ])
        ])
      ]),
      h('#trees', {key: 'sources'}, this.state.sources.map(s =>
        h(Tree, {root: s})
      )),
      h('#log', {key: 'log'}, this.state.log.map(entry =>
        h('p', {key: entry}, entry)
      ))
    ]
  }
}

function Tree ({root}) {
  return (
    h('.tree', [
      h('h1', root),
      h('table', [
        h('tbody', g.outEdges(root).map(({v, w}) => {
          let {name, size} = g.edge(v, w)

          return (
            h('tr', {key: w}, [
              h('th', name),
              h('td', size),
              h('td', [ h(Tree, {root: w}) ])
            ])
          )
        }))
      ])
    ])
  )
}

render(h(App), document.body)


