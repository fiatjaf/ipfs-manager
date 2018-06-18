const ipfs = window.ipfs
const localStorage = window.localStorage
const sessionStorage = window.sessionStorage
const graphlib = require('graphlib')
const CID = require('cids')
const render = require('react-dom').render
const React = require('react')
const h = require('react-hyperscript')
const prettyBytes = require('pretty-bytes')


const nonDirBlocks = JSON.parse(localStorage.getItem('non-dir-blocks') || '{}')
const dirBlocks = JSON.parse(sessionStorage.getItem('dir-blocks') || '{}')
const g = window.g = new graphlib.Graph({directed: true})

class App extends React.Component {
  constructor (props) {
    super(props)

    this.state = {
      log: [],
      logIndex: 1,
      npins: null,
      sources: [],
      selected: null
    }
  }

  async componentDidMount () {
    this.log('reading all pinned refs (this may take a while)')
    let pins = await ipfs.pin.ls()
    this.log(`got ${pins.length} refs`)

    this.setState({npins: pins.length})

    for (let i = 0; i < pins.length; i++) {
      let {hash} = pins[i]
      await this.checkDirectory(hash)
    }

    this.log('finished reading refs')

    this.recalc()
  }

  log (message) {
    this.setState(st => {
      st.log.unshift(`${st.logIndex}: ${message}`)
      st.log = st.log.slice(0, 50)
      st.logIndex++
      return st
    })
  }

  async recalc () {
    let sources = g.sources()

    this.setState({sources})
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
      h('main', {key: 'main'}, [
        this.state.selected &&
          h(Sidebar, {
            onUnpin: hash => this.unpin(hash),
            hash: this.state.selected
          }),
        h('#tree', {key: 'tree'}, this.state.sources.map(hash =>
          h(Tree, {
            hash,
            onSelect: h => this.select(h)
          })
        ))
      ]),
      h('#log', {key: 'log'}, this.state.log.map(entry =>
        h('p', {key: entry}, entry)
      ))
    ]
  }

  select (hash) {
    if (hash === this.state.selected) {
      this.setState({selected: null})
    }

    this.setState({selected: hash})
  }

  async unpin (hash) {
    await ipfs.pin.rm(hash, {recursive: true})

    removeWithOrphanDescendants(hash)

    this.recalc()
  }
}

class Tree extends React.Component {
  constructor (props) {
    super(props)

    this.state = {
      opened: false
    }

    this.nChildren = g.outEdges(props.hash).length
  }

  render () {
    return (
      h('.tree', [
        h('div', [
          this.nChildren > 0
            ? h('span.n-children',
              `(${this.nChildren} ${this.nChildren > 1 ? 'children' : 'child'})`
            )
            : h('span.n-children'),
          this.nChildren > 0 &&
            h('a.open', {
              onClick: e => {
                e.preventDefault()
                this.setState({opened: !this.state.opened})
              }
            }, this.state.opened ? '-' : '+'),
          h('span.name', this.props.name || ''),
          ' ',
          h('span.hash', [
            h('a', {
              href: `https://ipfs.io/ipfs/${this.props.hash}`,
              target: '_blank'
            }, this.props.hash)
          ]),
          ' ',
          h('span.size', [
            h('a', {
              onClick: e => {
                e.preventDefault()
                this.props.onSelect(this.props.hash)
              }
            }, typeof this.props.size === 'number' ? prettyBytes(this.props.size) : '~')
          ])
        ]),
        this.state.opened
          ? h('ul', g.outEdges(this.props.hash).map(({v, w}) => {
            let {size, name} = g.edge(v, w)

            return (
              h('li', [
                h(Tree, {
                  onSelect: hash => this.props.onSelect(hash),
                  hash: w,
                  name,
                  size
                })
              ])
            )
          }))
          : null
      ])
    )
  }
}

class Sidebar extends React.Component {
  constructor (props) {
    super(props)

    this.state = {
      providers: null
    }
  }

  render () {
    return (
      h('#sidebar', [
        h('h1', this.props.hash),
        h('h2', g.node(this.props.hash) ? 'pinned' : 'not pinned'),
        h('div', [
          'Linked',
          h('table', [
            h('thead', [
              h('tr', [
                h('th', 'on'),
                h('th', 'as')
              ])
            ]),
            h('tbody', g.inEdges(this.props.hash).map(({v, w}) =>
              h('tr', [
                h('td', [
                  h('a', {href: `https://ipfs.io/ipfs/${v}`, target: '_blank'}, v)
                ]),
                h('td', g.edge(v, w).name)
              ])
            ))
          ])
        ]),
        h('.providers', [
          this.state.providers
            ? [
              h('p', `${this.state.providers.length} providers.`),
              h('ul', this.state.providers.map(p =>
                h('li', p.ID)
              ))
            ]
            : h('button', {
              onClick: async e => {
                e.preventDefault()

                let providers = await ipfs.dht.findprovs(this.props.hash)
                this.setState({providers})
              }
            }, 'Find providers')
        ]),
        h('.commands', [
          h('button', {
            onClick: e => {
              e.preventDefault()

              this.props.onUnpin()
            }
          }, 'Unpin')
        ])
      ])
    )
  }
}

function removeWithOrphanDescendants (hash) {
  // get all children of <hash> and remove those
  // who will be orphans once we remove <hash>.
  g.outEdges(hash).forEach(dep => {
    if (g.inEdges(dep).length === 1) {
      removeWithOrphanDescendants(dep)
    }
  })
  g.removeNode(hash)
}

render(h(App), document.body)


