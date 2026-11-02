import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Acacia } from './Acacia'
import { usePrefersReducedMotion } from './scene-support'
import {
  CARE_SLOTS,
  LANE_CENTER,
  TwinQueueSimulation,
  type LaneId,
  type SimAgent,
} from './twin-queue'

const MAX_AGENTS = 64
const NIGHT = '#170f0b'

function makeSignTexture(title: string, subtitle: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 320
  const context = canvas.getContext('2d')
  if (context) {
    context.clearRect(0, 0, 1024, 320)
    context.fillStyle = 'rgba(20, 13, 9, 0.92)'
    context.beginPath()
    context.roundRect(8, 8, 1008, 304, 44)
    context.fill()
    context.strokeStyle = 'rgba(245, 233, 213, 0.22)'
    context.lineWidth = 3
    context.stroke()
    context.fillStyle = accent
    context.beginPath()
    context.arc(90, 160, 13, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#f5e9d5'
    context.font = '600 118px Manrope, sans-serif'
    context.textBaseline = 'middle'
    context.fillText(title, 135, 143)
    context.fillStyle = 'rgba(245, 233, 213, 0.55)'
    context.font = '600 31px Manrope, sans-serif'
    context.letterSpacing = '7px'
    context.fillText(subtitle.toUpperCase(), 139, 233)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function Sign({
  title,
  subtitle,
  accent,
  position,
  width = 3.4,
}: {
  title: string
  subtitle: string
  accent: string
  position: [number, number, number]
  width?: number
}) {
  const texture = useMemo(() => makeSignTexture(title, subtitle, accent), [title, subtitle, accent])
  return (
    <sprite position={position} scale={[width, width * 0.3125, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  )
}

function StaffFigure({
  position,
  coat = '#e9ddc7',
  skin = '#5b3927',
  rotation = 0,
}: {
  position: [number, number, number]
  coat?: string
  skin?: string
  rotation?: number
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.22, 0.84, 10]} />
        <meshStandardMaterial color={coat} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.97, 0]} castShadow>
        <sphereGeometry args={[0.125, 12, 10]} />
        <meshStandardMaterial color={skin} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.98, 0]} scale={[1.05, 0.72, 1.05]}>
        <sphereGeometry args={[0.135, 12, 10]} />
        <meshStandardMaterial color="#1d1410" roughness={0.95} />
      </mesh>
    </group>
  )
}

function RegistrationBooth({ lane }: { lane: LaneId }) {
  const x = LANE_CENTER[lane]
  const isDigital = lane === 'afribok'
  const accent = isDigital ? '#9fbea4' : '#d6a16b'
  return (
    <group position={[x, 0, -0.9]}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.5, 1, 0.68]} />
        <meshStandardMaterial color={isDigital ? '#30463a' : '#4a3427'} roughness={0.82} />
      </mesh>
      <mesh position={[0, 1.02, 0]} castShadow>
        <boxGeometry args={[2.66, 0.08, 0.78]} />
        <meshStandardMaterial color="#d6c2a1" roughness={0.65} />
      </mesh>
      <mesh position={[0, 1.12, -0.08]}>
        <boxGeometry args={[0.72, 0.12, 0.42]} />
        <meshStandardMaterial
          color={isDigital ? '#8bb18f' : '#c9b38c'}
          emissive={isDigital ? '#5b9a6d' : '#2b1a10'}
          emissiveIntensity={isDigital ? 1.1 : 0.2}
          roughness={0.5}
        />
      </mesh>
      {!isDigital &&
        [0, 1, 2, 3].map((index) => (
          <mesh
            key={index}
            position={[0.62, 1.08 + index * 0.035, 0.03]}
            rotation={[0, (index - 1.5) * 0.045, 0]}
            castShadow
          >
            <boxGeometry args={[0.5, 0.032, 0.34]} />
            <meshStandardMaterial color={index % 2 === 0 ? '#e3d3b3' : '#cbb791'} roughness={0.9} />
          </mesh>
        ))}
      {isDigital && (
        <mesh position={[0.58, 1.18, 0.02]} rotation={[0, 0, -0.1]}>
          <boxGeometry args={[0.42, 0.03, 0.3]} />
          <meshStandardMaterial
            color="#b4c9af"
            emissive="#7ea987"
            emissiveIntensity={1.4}
            roughness={0.35}
          />
        </mesh>
      )}
      {[-1.05, 1.05].map((postX) => (
        <mesh key={postX} position={[postX, 1.45, 0.06]} castShadow>
          <cylinderGeometry args={[0.035, 0.045, 2.1, 7]} />
          <meshStandardMaterial color="#3b2a1c" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 2.48, 0.06]} castShadow>
        <boxGeometry args={[2.45, 0.08, 1.15]} />
        <meshStandardMaterial color={isDigital ? '#2f4a3c' : '#5b3d29'} roughness={0.8} />
      </mesh>
      <StaffFigure position={[0, 0, -0.95]} coat={isDigital ? '#d9e2d5' : '#e9ddc7'} skin="#553422" />
      <Sign
        title={isDigital ? 'AFRIBOK' : 'PAPER'}
        subtitle={isDigital ? 'Digital check-in' : 'Forms & registers'}
        accent={accent}
        position={[0, 3.15, 0.08]}
        width={3.05}
      />
      <mesh position={[0, 0.05, 0.62]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.36, 0.44, 32]} />
        <meshBasicMaterial color={accent} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function CarePavilion() {
  const posts: Array<[number, number]> = [
    [-4.7, -3.8],
    [4.7, -3.8],
    [-4.7, -6.65],
    [4.7, -6.65],
  ]
  return (
    <group position={[0, 0, -5.4]}>
      {posts.map(([x, z], index) => (
        <mesh key={index} position={[x, 1.35, z + 5.4]} castShadow>
          <cylinderGeometry args={[0.045, 0.06, 2.7, 7]} />
          <meshStandardMaterial color="#6c5135" roughness={0.8} />
        </mesh>
      ))}
      {[-1.4, -0.7, 0, 0.7, 1.4].map((offset, index) => (
        <mesh key={index} position={[0, 2.7, offset]} castShadow>
          <boxGeometry args={[9.9, 0.08, 0.14]} />
          <meshStandardMaterial color="#5d4731" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 2.7, -1.8]} castShadow>
        <boxGeometry args={[9.9, 0.1, 0.15]} />
        <meshStandardMaterial color="#5d4731" roughness={0.8} />
      </mesh>
      <Sign title="CARE" subtitle="Shared clinical area" accent="#9fbea4" position={[0, 3.65, -0.2]} width={2.6} />
      {CARE_SLOTS.map((slot, index) => (
        <group key={index} position={[slot.x, 0, slot.z + 5.4 - 0.2]}>
          <mesh position={[0, 0.12, 0]} receiveShadow>
            <boxGeometry args={[0.95, 0.22, 1.7]} />
            <meshStandardMaterial color="#6f5c45" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.28, 0]}>
            <boxGeometry args={[0.82, 0.1, 1.52]} />
            <meshStandardMaterial color="#d9cdb7" roughness={0.9} />
          </mesh>
          <mesh position={[0.36, 0.45, 0.62]}>
            <boxGeometry args={[0.18, 0.34, 0.36]} />
            <meshStandardMaterial color="#b7c8b2" roughness={0.8} />
          </mesh>
        </group>
      ))}
      <StaffFigure position={[-4.15, 0, -0.8]} coat="#dfe8d9" skin="#6a4630" rotation={0.75} />
      <StaffFigure position={[4.15, 0, -0.75]} coat="#dfe8d9" skin="#4a2f20" rotation={-0.75} />
    </group>
  )
}

function Lantern({
  position,
  color,
  intensity = 1.1,
  distance = 5,
}: {
  position: [number, number, number]
  color: string
  intensity?: number
  distance?: number
}) {
  return (
    <group position={position}>
      <mesh position={[0, -0.35, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.7, 5]} />
        <meshStandardMaterial color="#2d1d12" />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.11, 12, 10]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <pointLight color={color} intensity={intensity} distance={distance} decay={2} />
    </group>
  )
}

function Floor({ lane }: { lane: LaneId }) {
  const x = LANE_CENTER[lane]
  const color = lane === 'afribok' ? '#7e9d80' : '#b67c4f'
  return (
    <group>
      <mesh position={[x, 0.012, 1.15]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3.7, 10.4]} />
        <meshStandardMaterial color={color} transparent opacity={0.075} roughness={1} />
      </mesh>
      {[0, 1, 2, 3, 4].map((row) => (
        <mesh key={row} position={[x, 0.02, 0.55 + row * 1.12]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.04, 0.06, 12]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} />
        </mesh>
      ))}
    </group>
  )
}

function Platform() {
  return (
    <group>
      <mesh position={[0, -0.35, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[10.2, 10.5, 0.7, 72]} />
        <meshStandardMaterial color="#22170f" roughness={0.92} metalness={0.04} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[10.2, 72]} />
        <meshStandardMaterial color="#3a2a1d" roughness={0.93} metalness={0.03} />
      </mesh>
      <mesh position={[0, 0.028, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[8.85, 8.95, 96]} />
        <meshBasicMaterial color="#d7b487" transparent opacity={0.3} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[10.05, 10.15, 96]} />
        <meshBasicMaterial color="#caa274" transparent opacity={0.22} />
      </mesh>
      <mesh position={[0, 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.035, 17.5]} />
        <meshBasicMaterial color="#d7b487" transparent opacity={0.28} />
      </mesh>
      <Floor lane="paper" />
      <Floor lane="afribok" />
    </group>
  )
}

function Patients({ sim }: { sim: TwinQueueSimulation }) {
  const body = useRef<THREE.InstancedMesh>(null)
  const head = useRef<THREE.InstancedMesh>(null)
  const ring = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const bodyColor = useMemo(() => new THREE.Color(), [])
  const headColor = useMemo(() => new THREE.Color(), [])
  const ringColor = useMemo(() => new THREE.Color(), [])
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const context = canvas.getContext('2d')
    if (context) {
      const gradient = context.createRadialGradient(64, 64, 28, 64, 64, 62)
      gradient.addColorStop(0, 'rgba(255,255,255,0)')
      gradient.addColorStop(0.62, 'rgba(255,255,255,.1)')
      gradient.addColorStop(0.8, 'rgba(255,255,255,.85)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, 128, 128)
    }
    return new THREE.CanvasTexture(canvas)
  }, [])

  useLayoutEffect(() => {
    for (const mesh of [body.current, head.current, ring.current]) {
      if (!mesh) continue
      for (let i = 0; i < MAX_AGENTS; i++) {
        mesh.setColorAt(i, bodyColor.set('#ffffff'))
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [bodyColor])

  useFrame(() => {
    if (!body.current || !head.current || !ring.current) return
    const agents = sim.agents.slice(0, MAX_AGENTS)
    agents.forEach((agent, index) => {
      const moving =
        agent.state === 'to_queue' ||
        agent.state === 'to_desk' ||
        agent.state === 'to_care' ||
        agent.state === 'leaving' ||
        agent.state === 'waiting_for_care'
      const bob = moving ? Math.abs(Math.sin(sim.elapsed * 7 + agent.phase)) * 0.045 : 0
      dummy.position.set(agent.x, 0.02 + bob, agent.z)
      dummy.rotation.set(0, agent.heading, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      body.current?.setMatrixAt(index, dummy.matrix)
      dummy.position.set(agent.x, 0.98 + bob, agent.z)
      dummy.rotation.set(0, agent.heading, 0)
      dummy.updateMatrix()
      head.current?.setMatrixAt(index, dummy.matrix)
      dummy.position.set(agent.x, 0.036, agent.z)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.updateMatrix()
      ring.current?.setMatrixAt(index, dummy.matrix)
      if (body.current) body.current.setColorAt(index, bodyColor.set(agent.bodyColor))
      if (head.current) head.current.setColorAt(index, headColor.set(agent.headColor))
      if (ring.current) ring.current.setColorAt(index, ringColor.set(agent.lane === 'afribok' ? '#a6c7a6' : '#d29962'))
    })
    for (let index = agents.length; index < MAX_AGENTS; index++) {
      dummy.position.set(0, -10, 0)
      dummy.scale.set(0.001, 0.001, 0.001)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      body.current.setMatrixAt(index, dummy.matrix)
      head.current.setMatrixAt(index, dummy.matrix)
      ring.current.setMatrixAt(index, dummy.matrix)
    }
    body.current.instanceMatrix.needsUpdate = true
    head.current.instanceMatrix.needsUpdate = true
    ring.current.instanceMatrix.needsUpdate = true
    if (body.current.instanceColor) body.current.instanceColor.needsUpdate = true
    if (head.current.instanceColor) head.current.instanceColor.needsUpdate = true
    if (ring.current.instanceColor) ring.current.instanceColor.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={body} args={[undefined, undefined, MAX_AGENTS]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.105, 0.225, 0.82, 9]} />
        <meshStandardMaterial roughness={0.85} metalness={0.02} />
      </instancedMesh>
      <instancedMesh ref={head} args={[undefined, undefined, MAX_AGENTS]} castShadow frustumCulled={false}>
        <sphereGeometry args={[0.118, 10, 8]} />
        <meshStandardMaterial roughness={0.72} metalness={0.01} />
      </instancedMesh>
      <instancedMesh ref={ring} args={[undefined, undefined, MAX_AGENTS]} frustumCulled={false}>
        <planeGeometry args={[1.1, 1.1]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={0.85}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>
    </>
  )
}

function Dust() {
  const count = 170
  const positions = useMemo(() => {
    const array = new Float32Array(count * 3)
    for (let index = 0; index < count; index++) {
      const angle = (index / count) * Math.PI * 2 * 5.1
      const radius = 2 + ((index * 37) % 100) / 100 * 8
      array[index * 3] = Math.cos(angle) * radius
      array[index * 3 + 1] = 0.4 + ((index * 53) % 100) / 100 * 5.2
      array[index * 3 + 2] = Math.sin(angle) * radius
    }
    return array
  }, [])
  const points = useRef<THREE.Points>(null)
  useFrame((state) => {
    if (points.current) {
      points.current.rotation.y = state.clock.elapsedTime * 0.012
    }
  })
  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#f1bd84" size={0.035} transparent opacity={0.5} depthWrite={false} sizeAttenuation />
    </points>
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
    const narrow = size.width < 820
    const base: [number, number, number] = narrow ? [13.5, 11, 18] : [10.8, 8.6, 13.5]
    const driftX = reduced ? 0 : pointer.current.x * 0.7 + Math.sin(state.clock.elapsedTime * 0.08) * 0.28
    const driftY = reduced ? 0 : pointer.current.y * 0.22
    camera.position.x = THREE.MathUtils.damp(camera.position.x, base[0] + driftX, 1.8, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, base[1] - driftY, 1.8, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, base[2], 1.8, delta)
    camera.lookAt(0, 0.6, -1.2)
  })

  return null
}

function Scene({ sim, reduced }: { sim: TwinQueueSimulation; reduced: boolean }) {
  return (
    <>
      <CameraRig reduced={reduced} />
      <fog attach="fog" args={[NIGHT, 28, 48]} />
      <hemisphereLight args={['#efc18d', '#170d08', 1.1]} />
      <ambientLight intensity={0.35} color="#6d4631" />
      <directionalLight
        position={[8, 14, 7]}
        intensity={2.6}
        color="#ffd3a4"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-13}
        shadow-camera-right={13}
        shadow-camera-top={13}
        shadow-camera-bottom={-13}
        shadow-bias={-0.0004}
      />
      <pointLight position={[0, 4.5, -5]} color="#a8c9aa" intensity={12} distance={12} decay={2} />
      <Platform />
      <RegistrationBooth lane="paper" />
      <RegistrationBooth lane="afribok" />
      <CarePavilion />
      <Patients sim={sim} />
      <Dust />
      <group>
        <Acacia position={[-8.3, 0, 3.6]} scale={0.66} color="#110a07" lit rotation={0.4} />
        <Acacia position={[8.5, 0, 4.3]} scale={0.52} color="#110a07" lit rotation={-0.7} />
        <Acacia position={[-8.6, 0, -2.8]} scale={0.44} color="#110a07" lit rotation={1.2} />
        <Acacia position={[8.7, 0, -2.2]} scale={0.58} color="#110a07" lit rotation={-0.2} />
      </group>
      <Lantern position={[-7.3, 1.7, 0.9]} color="#f0b978" />
      <Lantern position={[7.3, 1.7, 0.9]} color="#f0b978" />
      <Lantern position={[0, 3.1, -6.6]} color="#b7d3b5" intensity={2} distance={7} />
    </>
  )
}

export default function QueueSimulationScene({ sim }: { sim: TwinQueueSimulation }) {
  const reduced = usePrefersReducedMotion()
  return (
    <Canvas
      shadows
      dpr={[1, 1.55]}
      camera={{ position: [10.8, 8.6, 13.5], fov: 33, near: 0.1, far: 80 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0)
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.05
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Scene sim={sim} reduced={reduced} />
    </Canvas>
  )
}

export function agentCount(agents: SimAgent[]): number {
  return agents.length
}
