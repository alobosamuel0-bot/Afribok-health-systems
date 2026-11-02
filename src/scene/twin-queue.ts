export type LaneId = 'paper' | 'afribok'

export type AgentState =
  | 'to_queue'
  | 'queued'
  | 'to_desk'
  | 'in_service'
  | 'to_care'
  | 'waiting_for_care'
  | 'in_care'
  | 'leaving'
  | 'done'

export interface SimAgent {
  id: number
  lane: LaneId
  state: AgentState
  x: number
  z: number
  targetX: number
  targetZ: number
  heading: number
  bodyColor: string
  headColor: string
  phase: number
  serviceLeft: number
  careSlot: number | null
  startedAt: number
  queueSlot: number
}

export interface LaneSnapshot {
  waiting: number
  inService: number
  inCare: number
  seen: number
  arrivals: number
}

export interface SimSnapshot {
  paper: LaneSnapshot
  afribok: LaneSnapshot
  elapsed: number
  cycleProgress: number
  cycle: number
  paused: boolean
  totalArrivals: number
}

interface Lane {
  id: LaneId
  center: number
  registrationSeconds: number
  queue: number[]
  careWaiting: number[]
  deskAgent: number | null
  deskServiceLeft: number
  arrivals: number
  seen: number
  multiplier: number
}

export const LANE_CENTER: Record<LaneId, number> = {
  paper: -4.25,
  afribok: 4.25,
}

export const CARE_SLOTS: Array<{ x: number; z: number }> = [
  { x: -3.2, z: -5.4 },
  { x: -1.1, z: -5.4 },
  { x: 1.1, z: -5.4 },
  { x: 3.2, z: -5.4 },
]
export const CARE_CAPACITY = CARE_SLOTS.length

const QUEUE_COLUMNS = 4
const QUEUE_START_Z = 0.55
const QUEUE_ROW_GAP = 1.12
const QUEUE_COLUMN_GAP = 1.15
const DESK_Z = -0.9
const CARE_SECONDS = 2.35
const ARRIVAL_COUNT = 24
const ARRIVAL_INTERVAL = 1.85
const CYCLE_SECONDS = 61
const WALK_SPEED = 2.2

// Both lanes start mid-morning with a backlog and then receive the same
// arrivals. Starting warm means the cost of paperwork is visible immediately
// instead of only after a minute of waiting for queues to build.
const INITIAL_BACKLOG: Record<LaneId, number> = { paper: 8, afribok: 1 }

const BODY_COLORS = ['#b96d46', '#8a5a3e', '#c08a5b', '#6f7f5b', '#a34f38', '#7c6650', '#9c7452', '#875b45']
const HEAD_COLORS = ['#6b412c', '#4e2f22', '#8a573b', '#5f3a29', '#3f281d', '#7a4a32']

function seeded(index: number): number {
  const x = Math.sin(index * 91.73 + 17.13) * 43758.5453
  return x - Math.floor(x)
}

function queuePosition(lane: LaneId, slot: number): { x: number; z: number } {
  const row = Math.floor(slot / QUEUE_COLUMNS)
  const column = slot % QUEUE_COLUMNS
  const direction = row % 2 === 0 ? 1 : -1
  return {
    x: LANE_CENTER[lane] + (column - (QUEUE_COLUMNS - 1) / 2) * QUEUE_COLUMN_GAP * direction,
    z: QUEUE_START_Z + row * QUEUE_ROW_GAP,
  }
}

function deskPosition(lane: LaneId): { x: number; z: number } {
  return { x: LANE_CENTER[lane], z: DESK_Z + 0.62 }
}

export class TwinQueueSimulation {
  agents: SimAgent[] = []
  paused = false
  elapsed = 0
  cycle = 1
  private lanes: Record<LaneId, Lane> = {
    paper: {
      id: 'paper',
      center: LANE_CENTER.paper,
      registrationSeconds: 5.6,
      queue: [],
      careWaiting: [],
      deskAgent: null,
      deskServiceLeft: 0,
      arrivals: 0,
      seen: 0,
      multiplier: 1,
    },
    afribok: {
      id: 'afribok',
      center: LANE_CENTER.afribok,
      registrationSeconds: 1.35,
      queue: [],
      careWaiting: [],
      deskAgent: null,
      deskServiceLeft: 0,
      arrivals: 0,
      seen: 0,
      multiplier: 1,
    },
  }
  private nextAgentId = 1
  private nextArrivalAt = 0.6
  private arrivalsMade = 0
  private careOccupants: Array<{ lane: LaneId; agentId: number; left: number; slot: number }> = []

  constructor() {
    this.reset()
  }

  reset(incrementCycle = false) {
    if (incrementCycle) this.cycle += 1
    this.agents = []
    this.elapsed = 0
    this.nextAgentId = 1
    this.nextArrivalAt = 0.6
    this.arrivalsMade = 0
    this.careOccupants = []
    this.occupiedSlots.clear()
    for (const lane of Object.values(this.lanes)) {
      lane.queue = []
      lane.careWaiting = []
      lane.deskAgent = null
      lane.deskServiceLeft = 0
      lane.arrivals = 0
      lane.seen = 0
      this.seedBacklog(lane, INITIAL_BACKLOG[lane.id])
    }
    // Open both desks so the first visible state is "serving + queue",
    // rather than an empty field while everyone walks in.
    this.updateLane(this.lanes.paper, 0)
    this.updateLane(this.lanes.afribok, 0)
  }

  private seedBacklog(lane: Lane, count: number) {
    for (let index = 0; index < count; index++) {
      const slot = index
      const position = queuePosition(lane.id, slot)
      const agent: SimAgent = {
        id: this.nextAgentId++,
        lane: lane.id,
        state: 'queued',
        x: position.x,
        z: position.z,
        targetX: position.x,
        targetZ: position.z,
        heading: 0,
        bodyColor: BODY_COLORS[Math.floor(seeded(index + 31) * BODY_COLORS.length)],
        headColor: HEAD_COLORS[Math.floor(seeded(index + 41) * HEAD_COLORS.length)],
        phase: seeded(index + 51) * Math.PI * 2,
        serviceLeft: 0,
        careSlot: null,
        startedAt: 0,
        queueSlot: slot,
      }
      lane.queue.push(agent.id)
      this.agents.push(agent)
    }
  }

  snapshot(): SimSnapshot {
    const summarize = (lane: Lane): LaneSnapshot => ({
      waiting: lane.queue.length,
      inService: lane.deskAgent !== null ? 1 : 0,
      inCare: this.careOccupants.filter((occupant) => occupant.lane === lane.id).length,
      seen: lane.seen,
      arrivals: lane.arrivals,
    })
    return {
      paper: summarize(this.lanes.paper),
      afribok: summarize(this.lanes.afribok),
      elapsed: this.elapsed,
      cycleProgress: Math.min(1, this.elapsed / CYCLE_SECONDS),
      cycle: this.cycle,
      paused: this.paused,
      totalArrivals: this.arrivalsMade,
    }
  }

  step(rawDelta: number) {
    if (this.paused) return
    const delta = Math.min(rawDelta, 0.05)
    this.elapsed += delta

    if (this.elapsed > CYCLE_SECONDS) {
      this.reset(true)
      return
    }

    if (this.arrivalsMade < ARRIVAL_COUNT && this.elapsed >= this.nextArrivalAt) {
      this.nextArrivalAt += ARRIVAL_INTERVAL
      this.arrivalsMade += 1
      this.spawnArrival(this.lanes.paper)
      this.spawnArrival(this.lanes.afribok)
    }

    this.updateLane(this.lanes.paper, delta)
    this.updateLane(this.lanes.afribok, delta)
    this.updateCareQueue(delta)
    this.updateAgents(delta)
    this.agents = this.agents.filter((agent) => agent.state !== 'done')
  }

  private spawnArrival(lane: Lane) {
    const count = lane.arrivals
    lane.arrivals += 1
    const firstSlot = queuePosition(lane.id, lane.queue.length)
    const queueSlot = lane.queue.length
    const agent: SimAgent = {
      id: this.nextAgentId++,
      lane: lane.id,
      state: 'to_queue',
      x: lane.center + (seeded(count + 4) - 0.5) * 1.6,
      z: 6.1 + (seeded(count + 8) - 0.5) * 0.5,
      targetX: firstSlot.x,
      targetZ: firstSlot.z,
      heading: Math.PI,
      bodyColor: BODY_COLORS[Math.floor(seeded(count + 13) * BODY_COLORS.length)],
      headColor: HEAD_COLORS[Math.floor(seeded(count + 17) * HEAD_COLORS.length)],
      phase: seeded(count + 21) * Math.PI * 2,
      serviceLeft: 0,
      careSlot: null,
      startedAt: this.elapsed,
      queueSlot,
    }
    lane.queue.push(agent.id)
    this.agents.push(agent)
  }

  private updateLane(lane: Lane, delta: number) {
    // Advance the first waiting person when the desk is free.
    if (!lane.deskAgent && lane.queue.length > 0) {
      const nextId = lane.queue.shift() as number
      const agent = this.find(nextId)
      if (agent) {
        lane.deskAgent = nextId
        agent.state = 'to_desk'
        const target = deskPosition(lane.id)
        agent.targetX = target.x
        agent.targetZ = target.z
      }
    }

    if (lane.deskAgent) {
      const agent = this.find(lane.deskAgent)
      if (!agent) {
        lane.deskAgent = null
      } else if (agent.state === 'to_desk') {
        agent.targetX = deskPosition(lane.id).x
        agent.targetZ = deskPosition(lane.id).z
        if (Math.abs(agent.x - agent.targetX) < 0.1 && Math.abs(agent.z - agent.targetZ) < 0.1) {
          agent.state = 'in_service'
          lane.deskServiceLeft = lane.registrationSeconds / lane.multiplier
        }
      } else if (agent.state === 'in_service') {
        lane.deskServiceLeft -= delta
        if (lane.deskServiceLeft <= 0) {
          lane.deskAgent = null
          agent.state = 'to_care'
          if (agent.careSlot === null) {
            lane.careWaiting.push(agent.id)
            const waitingSpot = {
              x: lane.center + (agent.id % 2 === 0 ? -2.9 : 2.9),
              z: -2.7,
            }
            agent.targetX = waitingSpot.x
            agent.targetZ = waitingSpot.z
            agent.state = 'waiting_for_care'
          }
        }
      }
    }

    // Update targets for people still in the visible queue.
    lane.queue.forEach((agentId, index) => {
      const agent = this.find(agentId)
      if (!agent) return
      agent.queueSlot = index
      const target = queuePosition(lane.id, index)
      agent.targetX = target.x
      agent.targetZ = target.z
      if (agent.state === 'to_queue') {
        const distance = Math.hypot(agent.x - target.x, agent.z - target.z)
        if (distance < 0.15) agent.state = 'queued'
      }
    })
  }

  private updateCareQueue(delta: number) {
    // Finish care visits.
    for (const occupant of [...this.careOccupants]) {
      occupant.left -= delta
      if (occupant.left <= 0) {
        this.careOccupants = this.careOccupants.filter((entry) => entry.agentId !== occupant.agentId)
        const agent = this.find(occupant.agentId)
        if (agent) {
          agent.state = 'leaving'
          const lane = this.lanes[agent.lane]
          agent.targetX = lane.center + (agent.id % 2 === 0 ? 3.2 : -3.2)
          agent.targetZ = -8.8
          lane.seen += 1
        }
        this.releaseCareSlot(occupant.slot)
      }
    }

    // Move people waiting for care into open consulting slots.
    for (const lane of Object.values(this.lanes)) {
      while (lane.careWaiting.length > 0) {
        const freeSlot = this.findFreeCareSlot()
        if (freeSlot < 0) break
        const agentId = lane.careWaiting.shift() as number
        const agent = this.find(agentId)
        if (!agent) continue
        const slot = CARE_SLOTS[freeSlot]
        agent.careSlot = freeSlot
        agent.state = 'to_care'
        agent.targetX = slot.x
        agent.targetZ = slot.z
        this.careOccupants.push({
          lane: agent.lane,
          agentId,
          slot: freeSlot,
          left: CARE_SECONDS,
        })
      }
    }
  }

  private occupiedSlots = new Set<number>()

  private findFreeCareSlot(): number {
    for (let index = 0; index < CARE_CAPACITY; index++) {
      if (!this.occupiedSlots.has(index)) {
        this.occupiedSlots.add(index)
        return index
      }
    }
    return -1
  }

  private releaseCareSlot(slot: number) {
    this.occupiedSlots.delete(slot)
  }

  private updateAgents(delta: number) {
    for (const agent of this.agents) {
      if (agent.state === 'in_service') continue
      if (agent.state === 'in_care') continue
      const dx = agent.targetX - agent.x
      const dz = agent.targetZ - agent.z
      const distance = Math.hypot(dx, dz)
      if (distance > 0.02) {
        const step = Math.min(distance, WALK_SPEED * delta)
        agent.x += (dx / distance) * step
        agent.z += (dz / distance) * step
        agent.heading = Math.atan2(dx, dz)
      }
      if (agent.state === 'to_care' && distance < 0.08) agent.state = 'in_care'
      if (agent.state === 'leaving' && agent.z < -8.2) agent.state = 'done'
      if (agent.state === 'to_queue' && distance < 0.12) agent.state = 'queued'
    }
  }

  private find(id: number): SimAgent | undefined {
    return this.agents.find((agent) => agent.id === id)
  }
}

export const SIMULATION_LABELS = {
  paper: 'Paper & queues',
  afribok: 'Afribok workflow',
}
