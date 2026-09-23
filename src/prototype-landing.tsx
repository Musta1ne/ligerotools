import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileAudio,
  FileDown,
  FileImage,
  Film,
  Gauge,
  Image as ImageIcon,
  Scissors,
  Search,
  Sparkles,
  Repeat2,
  Volume2,
} from 'lucide-react'
import './prototype-landing.css'

const TOOLS = [
  {
    id: 'comprimir',
    name: 'Comprimir video',
    desc: 'Menos peso. Listo para compartir.',
    icon: Gauge,
    tag: 'video mp4 whatsapp reducir',
  },
  {
    id: 'convertir',
    name: 'Cambiar formato',
    desc: 'De MOV a MP4 y muchas otras opciones.',
    icon: Repeat2,
    tag: 'video convertir avi webm',
  },
  {
    id: 'descargar',
    name: 'Descargar de apps',
    desc: 'Guarda los videos que tienes permiso de descargar.',
    icon: Download,
    tag: 'video enlace link',
  },
  {
    id: 'recortar',
    name: 'Recortar video',
    desc: 'Quédate solo con la parte que importa.',
    icon: Scissors,
    tag: 'video cortar',
  },
  {
    id: 'audio',
    name: 'Extraer audio',
    desc: 'Tu video, ahora en MP3 o WAV.',
    icon: FileAudio,
    tag: 'audio video musica',
  },
  {
    id: 'comprimir-audio',
    name: 'Comprimir audio',
    desc: 'Menos peso, tú eliges la calidad.',
    icon: Volume2,
    tag: 'audio mp3 reducir',
  },
  {
    id: 'comprimir-imagen',
    name: 'Comprimir imágenes',
    desc: 'Imágenes más ligeras para cualquier lugar.',
    icon: ImageIcon,
    tag: 'imagen jpg png webp reducir',
  },
  {
    id: 'convertir-imagen',
    name: 'Convertir imágenes',
    desc: 'El formato que necesitas, sin vueltas.',
    icon: FileImage,
    tag: 'imagen jpg png webp cambiar',
  },
  {
    id: 'gif',
    name: 'Video a GIF',
    desc: 'Un pequeño momento, en loop.',
    icon: Film,
    tag: 'video imagen convertir',
  },
  {
    id: 'subtitulos',
    name: 'Extraer subtítulos',
    desc: 'Separa los subtítulos incluidos en tu video.',
    icon: FileDown,
    tag: 'video srt texto',
  },
]
const GROUPS = [
  {
    id: 'reducir',
    title: 'Hacerlo más pequeño',
    why: 'Para que quepa donde lo necesitas.',
    ids: ['comprimir', 'comprimir-audio', 'comprimir-imagen'],
  },
  {
    id: 'convertir',
    title: 'Cambiar de formato',
    why: 'Para que abra donde tú quieras.',
    ids: ['convertir', 'convertir-imagen', 'gif'],
  },
  {
    id: 'conseguir',
    title: 'Guardar o extraer',
    why: 'Ese video, ese audio, esos subtítulos.',
    ids: ['descargar', 'subtitulos', 'audio'],
  },
  {
    id: 'pulir',
    title: 'Quedarme con una parte',
    why: 'Lo que importa. Nada más.',
    ids: ['recortar'],
  },
]
const VARIANTS = [
  {
    key: 'A',
    name: 'Buscar primero',
    hypothesis: 'Una entrada, tres atajos. El catálogo aparece solo cuando lo necesitas.',
  },
  {
    key: 'B',
    name: 'Un protagonista',
    hypothesis: 'Una herramienta principal. Las otras nueve quedan en segundo plano.',
  },
  {
    key: 'C',
    name: 'Por necesidad',
    hypothesis: 'Cuatro decisiones sencillas antes de mostrar herramientas.',
  },
]
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
const readVariant = () => {
  const key = new URLSearchParams(window.location.search).get('variant')
  return VARIANTS.some((variant) => variant.key === key) ? key! : 'A'
}

function Header() {
  return (
    <header className="pl-header">
      <a className="pl-brand" href="?proto-landing=1">
        <span className="pl-brand-symbol">
          <Gauge size={19} />
        </span>
        ligero<span className="pl-dot">.</span>
        <small>tools</small>
      </a>
      <span className="pl-privacy">
        <span /> Menos vueltas. Más hecho.
      </span>
    </header>
  )
}

function Selection({ picked, clear }: { picked: string | null; clear: () => void }) {
  const tool = TOOLS.find((item) => item.id === picked)
  return tool ? (
    <div className="pl-selection" role="status">
      <Check size={18} />
      <div>
        <strong>{tool.name}</strong>
        <p>Así abrirías la herramienta. Esta demo no procesa ni descarga archivos.</p>
      </div>
      <button className="pl-linklike" onClick={clear}>
        Cerrar
      </button>
    </div>
  ) : null
}

type VariantProps = {
  picked: string | null
  pick: (id: string | null) => void
  query: string
  setQuery: (value: string) => void
  openGroup: string | null
  setOpenGroup: (value: string | null) => void
}

function VariantA({ picked, pick, query, setQuery }: VariantProps) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const q = normalize(query)
  const results = TOOLS.filter((tool) =>
    normalize(`${tool.name} ${tool.desc} ${tool.tag}`).includes(q),
  )
  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  return (
    <main className="pl-a-main">
      <p className="pl-eyebrow">
        <span className="pl-line" /> ARCHIVOS COMPLICADOS. SOLUCIONES SIMPLES.
      </p>
      <h1>
        Menos buscar.
        <br />
        <span className="pl-accent">Más resolver.</span>
      </h1>
      <p className="pl-sub">
        Tu video pesa mucho. Tu imagen no abre. Te falta un MP3.
        <br />
        Una pequeña herramienta para cada pequeño problema.
      </p>
      <div
        ref={boxRef}
        className="pl-palette-wrap"
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
      >
        <div className="pl-palette">
          <Search size={21} />
          <input
            aria-label="Buscar herramienta"
            aria-expanded={open}
            aria-controls="pl-search-results"
            placeholder="¿Qué necesitas? Prueba «comprimir»"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && results.length) {
                pick(results[0].id)
                setOpen(false)
              }
            }}
          />
          <span className="pl-search-count">{TOOLS.length} tools</span>
        </div>
        {open && (
          <ul id="pl-search-results" className="pl-results" aria-label="Herramientas encontradas">
            {results.map((tool) => (
              <li key={tool.id}>
                <button
                  onClick={() => {
                    pick(tool.id)
                    setOpen(false)
                  }}
                >
                  <tool.icon size={17} />
                  <strong>{tool.name}</strong>
                  <span>{tool.desc}</span>
                  <ArrowRight size={14} />
                </button>
              </li>
            ))}
            {!results.length && (
              <li className="pl-empty">
                No encontramos esa herramienta. Prueba «video», «audio» o «imagen».
              </li>
            )}
          </ul>
        )}
      </div>
      <div className="pl-shortcuts">
        <span>O ve directo a</span>
        {TOOLS.slice(0, 3).map((tool) => (
          <button key={tool.id} onClick={() => pick(tool.id)}>
            <tool.icon size={14} />
            {tool.name}
            <ArrowRight size={12} />
          </button>
        ))}
      </div>
      <Selection picked={picked} clear={() => pick(null)} />
      <div className="pl-a-bottom">
        <span>VIDEO</span>
        <i />
        <span>AUDIO</span>
        <i />
        <span>IMAGEN</span>
        <p>Tu caja de herramientas. No otra cosa que aprender.</p>
      </div>
    </main>
  )
}

function VariantB({ picked, pick }: VariantProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  const scroll = (dir: number) =>
    stripRef.current?.scrollBy({
      left: dir * 260,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    })
  return (
    <main>
      <section className="pl-b-hero">
        <div className="pl-b-copy">
          <p className="pl-eyebrow">
            <span className="pl-line" /> UNA COSA MENOS EN TU LISTA
          </p>
          <h1>
            Ese video.
            <br />
            Pero <span className="pl-accent">más ligero.</span>
          </h1>
          <p className="pl-sub">
            De «no se puede enviar» a «ya te lo mandé».
            <br />
            Empieza con nuestro compresor de video.
          </p>
          <button className="pl-b-action" onClick={() => pick('comprimir')}>
            Comprimir mi video <ArrowRight size={18} />
          </button>
          <p className="pl-b-local">
            <Check size={14} /> El compresor actual procesa en tu navegador.
          </p>
        </div>
        <div className="pl-b-preview" aria-label="Ejemplo ilustrativo de compresión">
          <span className="pl-example-label">MENOS PESO, EL MISMO MOMENTO</span>
          <div className="pl-file-large">
            <Film size={30} />
            <strong>vacaciones.mp4</strong>
            <span>128 MB</span>
          </div>
          <div className="pl-shrink-line">
            <ArrowDownToLine size={19} />
            <span>Un poco de magia práctica</span>
          </div>
          <div className="pl-file-small">
            <Film size={23} />
            <div>
              <strong>vacaciones-ligero.mp4</strong>
              <span>20 MB</span>
            </div>
            <span className="pl-file-check">
              <Check size={16} />
            </span>
          </div>
          <small>Ejemplo visual. El tamaño real puede variar.</small>
        </div>
      </section>
      <Selection picked={picked} clear={() => pick(null)} />
      <section className="pl-b-strip-section" aria-label="Más herramientas">
        <div className="pl-b-strip-head">
          <div>
            <p>¿Hoy necesitas otra cosa?</p>
            <span>Más soluciones. El mismo espíritu.</span>
          </div>
          <div>
            <button aria-label="Herramientas anteriores" onClick={() => scroll(-1)}>
              <ArrowLeft size={15} />
            </button>
            <button aria-label="Herramientas siguientes" onClick={() => scroll(1)}>
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
        <div className="pl-b-strip" ref={stripRef}>
          {TOOLS.slice(1).map((tool) => (
            <button key={tool.id} className="pl-b-card" onClick={() => pick(tool.id)}>
              <tool.icon size={19} />
              <strong>{tool.name}</strong>
              <span>{tool.desc}</span>
            </button>
          ))}
        </div>
        <p className="pl-b-strip-note">
          9 herramientas más en esta propuesta. Espacio para las que vendrán.
        </p>
      </section>
    </main>
  )
}

function VariantC({ picked, pick, openGroup, setOpenGroup }: VariantProps) {
  return (
    <main className="pl-c-main">
      <div className="pl-c-copy">
        <p className="pl-eyebrow">
          <span className="pl-line" /> A TU RITMO
        </p>
        <h1>
          No elijas
          <br />
          una herramienta.
          <br />
          <span className="pl-accent">Elige qué resolver.</span>
        </h1>
        <p className="pl-sub">
          Nosotros ponemos el nombre técnico.
          <br />
          Tú solo dinos qué necesitas hacer.
        </p>
        <p className="pl-c-note">
          <Sparkles size={16} /> Una cosa a la vez. Así de ligero.
        </p>
      </div>
      <div className="pl-c-catalog">
        <div className="pl-c-index">
          <span>¿POR DÓNDE EMPEZAMOS?</span>
          <span>01 — 04</span>
        </div>
        <div className="pl-c-groups">
          {GROUPS.map((group, index) => {
            const open = openGroup === group.id
            return (
              <section key={group.id} className={`pl-c-group ${open ? 'open' : ''}`}>
                <button
                  className="pl-c-trigger"
                  aria-expanded={open}
                  aria-controls={`pl-group-${group.id}`}
                  onClick={() => setOpenGroup(open ? null : group.id)}
                >
                  <span className="pl-c-number">0{index + 1}</span>
                  <div>
                    <strong>{group.title}</strong>
                    <span>{group.why}</span>
                  </div>
                  <span className="pl-c-count">
                    {group.ids.length}
                    <ArrowRight size={17} className={open ? 'rot' : ''} />
                  </span>
                </button>
                <ul id={`pl-group-${group.id}`} hidden={!open}>
                  {open &&
                    group.ids.map((id) => {
                      const tool = TOOLS.find((item) => item.id === id)!
                      return (
                        <li key={id}>
                          <button onClick={() => pick(id)}>
                            <tool.icon size={16} />
                            {tool.name}
                            <ArrowRight size={14} />
                          </button>
                        </li>
                      )
                    })}
                </ul>
              </section>
            )
          })}
        </div>
        <Selection picked={picked} clear={() => pick(null)} />
        <p className="pl-c-catalog-note">
          {TOOLS.length} herramientas, organizadas alrededor de ti.
        </p>
      </div>
    </main>
  )
}

function PrototypeSwitcher({
  current,
  cycle,
}: {
  current: string
  cycle: (direction: number) => void
}) {
  return (
    import.meta.env.DEV && (
      <nav className="pl-switcher" aria-label="Variantes del prototipo">
        <button onClick={() => cycle(-1)} aria-label="Variante anterior">
          <ArrowLeft size={16} />
        </button>
        <span>
          <small>PROTOTIPO</small>
          <strong>{current}</strong> · {VARIANTS.find((variant) => variant.key === current)?.name}
        </span>
        <button onClick={() => cycle(1)} aria-label="Variante siguiente">
          <ArrowRight size={16} />
        </button>
      </nav>
    )
  )
}

export function PrototypeLanding() {
  const [current, setCurrent] = useState(readVariant)
  const [picked, pick] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const cycle = (direction: number) => {
    const next =
      VARIANTS[
        (VARIANTS.findIndex((variant) => variant.key === current) + direction + VARIANTS.length) %
          VARIANTS.length
      ].key
    const url = new URL(window.location.href)
    url.searchParams.set('variant', next)
    window.history.replaceState(null, '', url)
    setCurrent(next)
    pick(null)
    setQuery('')
    setOpenGroup(null)
  }
  useEffect(() => {
    const previousTheme = document.documentElement.dataset.theme
    const previousTitle = document.title
    document.documentElement.dataset.theme = 'light'
    document.title = 'Ligero.tools — Prototipo de landing'
    return () => {
      if (previousTheme) document.documentElement.dataset.theme = previousTheme
      else delete document.documentElement.dataset.theme
      document.title = previousTitle
    }
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        )
      )
        return
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        cycle(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    const onPop = () => {
      setCurrent(readVariant())
      pick(null)
      setQuery('')
      setOpenGroup(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
    }
  })
  const props = { picked, pick, query, setQuery, openGroup, setOpenGroup }
  return (
    <div className="pl-root">
      <div className={`pl-page pl-${current.toLowerCase()}`}>
        <Header />
        {current === 'A' ? (
          <VariantA {...props} />
        ) : current === 'B' ? (
          <VariantB {...props} />
        ) : (
          <VariantC {...props} />
        )}
        <footer className="pl-footer">
          <span>ligero.tools</span>
          <span>Pequeñas herramientas. Un día más sencillo.</span>
          <span>Concepto de producto · Demo sin procesamiento</span>
        </footer>
        <details className="pl-state">
          <summary>Prototipo descartable · ¿Cómo mostrar 10+ tools sin abrumar?</summary>
          <p>{VARIANTS.find((variant) => variant.key === current)?.hypothesis}</p>
          <pre>
            {JSON.stringify(
              {
                variante: current,
                busqueda: query,
                grupoAbierto: openGroup,
                herramienta: picked,
                total: TOOLS.length,
                persistencia: false,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </div>
      <PrototypeSwitcher current={current} cycle={cycle} />
    </div>
  )
}
