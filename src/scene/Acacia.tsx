import { useMemo } from 'react'
import * as THREE from 'three'

function Limb({
  from,
  to,
  radius,
  color,
}: {
  from: [number, number, number]
  to: [number, number, number]
  radius: number
  color: string
}) {
  const { position, quaternion, length } = useMemo(() => {
    const start = new THREE.Vector3(...from)
    const end = new THREE.Vector3(...to)
    const direction = end.clone().sub(start)
    const length = direction.length()
    const midpoint = start.clone().add(direction.clone().multiplyScalar(0.5))
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.clone().normalize(),
    )
    return {
      position: midpoint.toArray() as [number, number, number],
      quaternion,
      length,
    }
  }, [from, to])

  return (
    <mesh position={position} quaternion={quaternion} castShadow>
      <cylinderGeometry args={[radius * 0.55, radius, length, 5]} />
      <meshBasicMaterial color={color} />
    </mesh>
  )
}

interface AcaciaProps {
  position?: [number, number, number]
  scale?: number
  color?: string
  rotation?: number
  lit?: boolean
}

const CANOPY: Array<[number, number, number, number, number, number]> = [
  [0, 3.18, 0, 1.42, 0.24, 0.94],
  [-0.72, 3.05, 0.1, 0.86, 0.18, 0.62],
  [0.76, 3.09, -0.04, 0.95, 0.19, 0.68],
  [-0.18, 3.32, -0.22, 0.86, 0.2, 0.64],
  [0.38, 3.3, 0.2, 0.8, 0.17, 0.57],
  [1.16, 2.96, 0.18, 0.56, 0.13, 0.42],
  [-1.12, 2.98, -0.18, 0.6, 0.13, 0.44],
]

export function Acacia({ position = [0, 0, 0], scale = 1, color = '#120b08', rotation = 0, lit = false }: AcaciaProps) {
  const trunkBranches = useMemo(
    () =>
      [
        { from: [0.02, 1.9, 0] as [number, number, number], to: [-0.72, 2.95, 0.06] as [number, number, number], radius: 0.05 },
        { from: [0.03, 2.02, 0] as [number, number, number], to: [0.72, 3.03, -0.02] as [number, number, number], radius: 0.045 },
        { from: [0.02, 1.82, 0] as [number, number, number], to: [0.14, 3.15, 0.1] as [number, number, number], radius: 0.05 },
        { from: [-0.02, 1.2, 0] as [number, number, number], to: [0.36, 2.3, 0.16] as [number, number, number], radius: 0.03 },
      ],
    [],
  )

  return (
    <group position={position} scale={scale} rotation={[0, rotation, 0]}>
      <mesh position={[0, 1.02, 0]} rotation={[0, 0, -0.045]} castShadow>
        <cylinderGeometry args={[0.09, 0.2, 2.04, 7]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[-0.05, 2.12, 0]} rotation={[0.1, 0, 0.08]} castShadow>
        <cylinderGeometry args={[0.05, 0.1, 0.9, 5]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {trunkBranches.map((branch, index) => (
        <Limb key={index} {...branch} color={color} />
      ))}
      {CANOPY.map(([x, y, z, sx, sy, sz], index) => (
        <mesh key={index} position={[x, y, z]} scale={[sx, sy, sz]} castShadow>
          <sphereGeometry args={[1, 9, 6]} />
          {lit ? (
            <meshStandardMaterial color={color} roughness={0.95} flatShading />
          ) : (
            <meshBasicMaterial color={color} />
          )}
        </mesh>
      ))}
    </group>
  )
}

export const ACACIA_SMALL = { position: [0, 0, 0] as [number, number, number], scale: 0.8 }
