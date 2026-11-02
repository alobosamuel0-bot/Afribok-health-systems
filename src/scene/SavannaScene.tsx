import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Acacia } from './Acacia'
import { usePrefersReducedMotion } from './scene-support'

const TREE_DARK = '#100a07'

function seeded(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function ridgeHeight(x: number, seed: number, amplitude: number): number {
  return (
    Math.sin(x * 0.17 + seed) * 0.55 * amplitude +
    Math.sin(x * 0.41 + seed * 2.4) * 0.16 * amplitude +
    Math.sin(x * 0.063 + seed * 0.7) * 0.9 * amplitude +
    Math.sin(x * 1.1 + seed * 4.2) * 0.018 * amplitude
  )
}

function Ridge({
  z,
  y,
  color,
  seed,
  amplitude = 1,
  width = 100,
}: {
  z: number
  y: number
  color: string
  seed: number
  amplitude?: number
  width?: number
}) {
  const geometry = useMemo(() => {
    const segments = 160
    const positions: number[] = []
    const indices: number[] = []
    for (let i = 0; i <= segments; i++) {
      const x = -width / 2 + (i / segments) * width
      const top = ridgeHeight(x, seed, amplitude)
      positions.push(x, top, 0)
      positions.push(x, -14, 0)
      if (i < segments) {
        const a = i * 2
        indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
      }
    }
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    buffer.setIndex(indices)
    buffer.computeVertexNormals()
    return buffer
  }, [amplitude, seed, width])

  return (
    <mesh geometry={geometry} position={[0, y, z]}>
      <meshBasicMaterial color={color} side={THREE.DoubleSide} />
    </mesh>
  )
}

function GrassField({ count = 480 }: { count?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const group = useRef<THREE.Group>(null)
  const geometry = useMemo(() => {
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-0.025, 0, 0, 0.025, 0, 0, 0.05, 1, 0, -0.02, 0.35, 0, 0.04, 0.55, 0],
        3,
      ),
    )
    buffer.setIndex([0, 1, 2, 0, 2, 3, 3, 2, 4])
    buffer.computeVertexNormals()
    return buffer
  }, [])
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#170d09', side: THREE.DoubleSide }),
    [],
  )

  useLayoutEffect(() => {
    if (!mesh.current) return
    const dummy = new THREE.Object3D()
    for (let i = 0; i < count; i++) {
      const t = i / count
      const x = (seeded(i + 1) - 0.5) * 24
      const z = 4.4 - t * 5.2 + seeded(i + 9) * 1.3
      const height = 0.18 + seeded(i + 3) * 0.85
      dummy.position.set(x, -2.35 + seeded(i + 7) * 0.12, z)
      dummy.scale.set(0.7 + seeded(i + 5) * 0.9, height, 1)
      dummy.rotation.y = seeded(i + 11) * Math.PI
      dummy.rotation.z = (seeded(i + 13) - 0.5) * 0.18
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
    }
    mesh.current.instanceMatrix.needsUpdate = true
  }, [count])

  useFrame((state) => {
    if (group.current) {
      group.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.35) * 0.004
    }
  })

  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} />
    </group>
  )
}

function Dust({ count = 220 }: { count?: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
      gradient.addColorStop(0, 'rgba(255,225,178,1)')
      gradient.addColorStop(0.35, 'rgba(245,183,120,0.6)')
      gradient.addColorStop(1, 'rgba(245,160,90,0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, 64, 64)
    }
    return new THREE.CanvasTexture(canvas)
  }, [])

  const positions = useMemo(() => {
    const array = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      array[i * 3] = (seeded(i + 4) - 0.5) * 24
      array[i * 3 + 1] = seeded(i + 8) * 7 - 0.8
      array[i * 3 + 2] = -14 + seeded(i + 12) * 18
    }
    return array
  }, [count])

  const points = useRef<THREE.Points>(null)
  useFrame((state) => {
    if (!points.current) return
    points.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.025) * 0.08
    points.current.position.y = Math.sin(state.clock.elapsedTime * 0.09) * 0.15
  })

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={texture}
        color="#f0b77b"
        size={0.075}
        transparent
        opacity={0.55}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  )
}

function WingGeometry() {
  const geometry = useMemo(() => {
    const shape = new THREE.BufferGeometry()
    shape.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0.62, 0.1, 0, 0.12, 0.16, 0, 0.02, 0.04, 0], 3),
    )
    shape.setIndex([0, 1, 2, 0, 2, 3])
    return shape
  }, [])
  return geometry
}

function Bird({
  offset,
  y,
  z,
  speed,
  scale,
}: {
  offset: number
  y: number
  z: number
  speed: number
  scale: number
}) {
  const group = useRef<THREE.Group>(null)
  const left = useRef<THREE.Group>(null)
  const right = useRef<THREE.Group>(null)
  const geometry = WingGeometry()
  const span = 32

  useFrame((state) => {
    const time = state.clock.elapsedTime
    const x = ((offset + time * speed) % span) - span / 2
    if (group.current) {
      group.current.position.set(x, y + Math.sin(time * 0.55 + offset) * 0.18, z)
    }
    const flap = Math.sin(time * 4.4 + offset * 2.1) * 0.45
    if (left.current) left.current.rotation.z = flap
    if (right.current) right.current.rotation.z = -flap
  })

  return (
    <group ref={group} scale={scale}>
      <group ref={left}>
        <mesh geometry={geometry} scale={[-1, 1, 1]}>
          <meshBasicMaterial color={TREE_DARK} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <group ref={right}>
        <mesh geometry={geometry}>
          <meshBasicMaterial color={TREE_DARK} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <mesh position={[0, 0.04, 0]}>
        <sphereGeometry args={[0.045, 6, 5]} />
        <meshBasicMaterial color={TREE_DARK} />
      </mesh>
    </group>
  )
}

function Flock() {
  const birds = useMemo(
    () =>
      Array.from({ length: 8 }, (_, index) => ({
        offset: seeded(index + 31) * 32,
        y: 4.1 + seeded(index + 2) * 1.5,
        z: -12 - seeded(index + 6) * 7,
        speed: 0.75 + seeded(index + 19) * 0.28,
        scale: 0.42 + seeded(index + 22) * 0.26,
      })),
    [],
  )
  return (
    <>
      {birds.map((bird, index) => (
        <Bird key={index} {...bird} />
      ))}
    </>
  )
}

function CameraRig({ reduced }: { reduced: boolean }) {
  const { camera, size } = useThree()
  const pointer = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    return () => window.removeEventListener('pointermove', onPointer)
  }, [])

  useFrame((state, delta) => {
    const narrow = size.width < 760
    const baseZ = narrow ? 14.5 : 11
    const targetX = reduced ? 0 : pointer.current.x * 0.5 + Math.sin(state.clock.elapsedTime * 0.065) * 0.15
    const targetY = reduced ? 1.9 : 1.9 - pointer.current.y * 0.24 + Math.sin(state.clock.elapsedTime * 0.05) * 0.06
    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 2.2, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetY, 2.2, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, baseZ, 1.5, delta)
    camera.lookAt(0, 2.15, -7)
  })
  return null
}

function Scene({ active, reduced }: { active: boolean; reduced: boolean }) {
  return (
    <>
      <CameraRig reduced={reduced} />
      <Ridge z={-24} y={2.4} color="#67382c" seed={1.4} amplitude={0.7} width={110} />
      <Ridge z={-18} y={1.5} color="#4d2922" seed={3.1} amplitude={1.1} />
      <Ridge z={-12} y={0.4} color="#321b17" seed={5.7} amplitude={1.5} />
      <Ridge z={-6} y={-0.9} color="#1e110d" seed={2.2} amplitude={1.1} />
      <Ridge z={-2.5} y={-1.8} color="#130b08" seed={8.4} amplitude={0.9} />

      <Acacia position={[-8.2, -1.45, -8]} scale={0.78} color={TREE_DARK} rotation={0.2} />
      <Acacia position={[-2.6, -1.05, -12.5]} scale={0.58} color={TREE_DARK} rotation={-0.4} />
      <Acacia position={[5.1, -1.9, -1.2]} scale={1.42} color={TREE_DARK} rotation={-0.15} />
      <Acacia position={[9.6, -1.5, -7.5]} scale={0.72} color={TREE_DARK} rotation={0.5} />

      <GrassField count={active ? 480 : 380} />
      <Dust count={active ? 230 : 120} />
      <Flock />
    </>
  )
}

export default function SavannaScene({ active }: { active: boolean }) {
  const reduced = usePrefersReducedMotion()
  return (
    <Canvas
      dpr={[1, 1.6]}
      camera={{ position: [0, 1.9, 11], fov: 38, near: 0.1, far: 100 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Scene active={active} reduced={reduced} />
    </Canvas>
  )
}
