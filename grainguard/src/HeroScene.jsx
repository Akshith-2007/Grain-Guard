import { Component, Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Float, useGLTF } from '@react-three/drei'
import { Box3, DoubleSide, MathUtils, Vector3 } from 'three'

/* ── Objects: file, size, fallback colour, path down the page ── */
const OBJECTS = [
  {
    url: '/models/maple.glb', size: 2.0, color: '#b5301f', turn: 1, tilt: 0.6,
    path: [[0.38, 0.12], [-0.78, 0.0], [0.8, 0.2], [-0.78, -0.1], [0.7, 0.0]],
  },
  {
    url: '/models/leaf2.glb', size: 2.0, color: '#4a8f2f', turn: -1, tilt: -0.5,
    path: [[-0.7, 0.25], [0.75, -0.1], [-0.75, 0.15], [0.7, 0.2], [-0.6, -0.05]],
  },
  {
    url: '/models/dry.glb', size: 2.0, color: '#8a6a3a', turn: 1, tilt: 0.3,
    path: [[0.65, -0.3], [-0.7, 0.1], [0.78, 0.0], [-0.75, -0.2], [0.7, 0.15]],
  },
]
const FORCE_COLOR = false // true = always use the colour above, even if the file has its own

const SPIN = 0.12, TILT = 0.35, FOLLOW = 3, FLOAT = 0.5, SCROLL_EASE = 3, SCROLL_TURNS = 1.5

// WebGL/canvas-level errors show on screen
class ErrorBox extends Component {
  state = { msg: null }
  static getDerivedStateFromError(e) { return { msg: String(e?.message || e) } }
  componentDidCatch(e) { console.error('3D error:', e) }
  render() {
    if (!this.state.msg) return this.props.children
    return (
      <div style={{ position: 'fixed', left: 16, bottom: 16, right: 16, zIndex: 99, padding: 12, background: '#b00020', color: '#fff', font: '13px monospace', whiteSpace: 'pre-wrap' }}>
        3D ERROR: {this.state.msg}
      </div>
    )
  }
}

// If one model fails, only that model disappears (the error is in the console)
class ModelGuard extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e) { console.error('Model failed:', this.props.name, e) }
  render() { return this.state.failed ? null : this.props.children }
}

function sample(path, t) {
  const n = path.length - 1
  const f = MathUtils.clamp(t, 0, 1) * n
  const i = Math.min(Math.floor(f), n - 1)
  const k = f - i
  const e = k * k * (3 - 2 * k)
  return [MathUtils.lerp(path[i][0], path[i + 1][0], e), MathUtils.lerp(path[i][1], path[i + 1][1], e)]
}

function Model({ url, size, color }) {
  const { scene } = useGLTF(url)
  const { obj, c, k } = useMemo(() => {
    const obj = scene.clone(true)
    obj.traverse((m) => {
      if (!m.isMesh) return
      const hasVertexColors = !!m.geometry?.attributes?.color
      const list = Array.isArray(m.material) ? m.material : [m.material]
      const fixed = list.map((mat) => {
        const x = mat.clone()
        x.side = DoubleSide
        if ('metalness' in x) x.metalness = Math.min(x.metalness, 0.3)
        if (FORCE_COLOR || (!x.map && !hasVertexColors)) {
          x.map = null
          x.vertexColors = false
          x.color.set(color)
          x.needsUpdate = true
        }
        return x
      })
      m.material = Array.isArray(m.material) ? fixed : fixed[0]
    })
    const box = new Box3().setFromObject(obj)
    const sz = box.getSize(new Vector3())
    const c = box.getCenter(new Vector3())
    return { obj, c, k: size / (Math.max(sz.x, sz.y, sz.z) || 1) }
  }, [scene, size, color])
  return (
    <group scale={k}>
      <primitive object={obj} position={[-c.x, -c.y, -c.z]} />
    </group>
  )
}

function Drifter({ path, turn = 1, tilt = 0.6, children }) {
  const place = useRef(null)
  const lean = useRef(null)
  const spin = useRef(null)
  const prog = useRef(0)
  const pointer = useRef({ x: 0, y: 0 })
  const viewport = useThree((s) => s.viewport)

  useEffect(() => {
    const onMove = (e) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const max = document.documentElement.scrollHeight - window.innerHeight
    const target = max > 0 ? MathUtils.clamp(window.scrollY / max, 0, 1) : 0
    prog.current = MathUtils.damp(prog.current, target, SCROLL_EASE, dt)
    const { width, height } = state.viewport
    const [nx, ny] = sample(path, prog.current)
    place.current.position.set((nx * width) / 2, (ny * height) / 2, 0)
    place.current.scale.setScalar(MathUtils.clamp(width / 5.5, 0.45, 1))
    spin.current.rotation.y += dt * SPIN
    spin.current.rotation.x += dt * SPIN * 0.45
    spin.current.rotation.z = prog.current * Math.PI * 2 * SCROLL_TURNS * turn
    lean.current.rotation.y = MathUtils.damp(lean.current.rotation.y, pointer.current.x * TILT, FOLLOW, dt)
    lean.current.rotation.x = MathUtils.damp(lean.current.rotation.x, pointer.current.y * TILT, FOLLOW, dt)
  })

  return (
    <group ref={place} position={[(path[0][0] * viewport.width) / 2, (path[0][1] * viewport.height) / 2, 0]}>
      <Float speed={1} rotationIntensity={0} floatIntensity={FLOAT}>
        <group ref={lean}>
          <group ref={spin} rotation={[0.35, tilt, 0]}>{children}</group>
        </group>
      </Float>
    </group>
  )
}

export default function HeroScene() {
  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      <ErrorBox>
        <Canvas flat dpr={[1, 1.5]} camera={{ position: [0, 0, 5], fov: 35 }} gl={{ antialias: true, alpha: true }}>
          <ambientLight intensity={0.6} />
          <hemisphereLight color="#ffffff" groundColor="#556070" intensity={0.6} />
          <directionalLight position={[4, 5, 5]} intensity={1.5} />
          <directionalLight position={[-4, -2, 3]} intensity={0.5} color="#d6e8ff" />

          {OBJECTS.map((o) => (
            <ModelGuard key={o.url} name={o.url}>
              <Suspense fallback={null}>
                <Drifter path={o.path} turn={o.turn} tilt={o.tilt}>
                  <Model url={o.url} size={o.size} color={o.color} />
                </Drifter>
              </Suspense>
            </ModelGuard>
          ))}
        </Canvas>
      </ErrorBox>
    </div>
  )
}