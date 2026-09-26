import type { Vec3 } from '../clips'
import { clamp01, smoothstep } from './phases'
export type Primitive = {
  type: 'linear' | 'arc' | 'semicircle' | 'circle' | 'ellipse' | 'zigzag' | 'bounce' | 'tap' | 'brush' | 'twist' | 'approach-contact' | 'contact-release'
  origin?: Vec3; direction?: Vec3; distance?: number; amplitude?: number
  curvature?: number; repetitions?: number; speed?: number; easing?: 'linear' | 'smooth'
}
/** Offset in normalized body coordinates. Twist additionally returns wrist roll. */
export function primitiveAt(def: Primitive, time: number): { offset: Vec3; twist: number } {
  const cycles = (def.repetitions ?? 1) * (def.speed ?? 1)
  const raw = clamp01(time) * cycles
  const p = time >= 1 ? 1 : raw % 1
  const t = def.easing === 'linear' ? p : smoothstep(p)
  const amp = def.amplitude ?? .075, distance = def.distance ?? .12
  let u = 0, v = 0, twist = 0
  switch (def.type) {
    case 'linear': case 'brush': u = distance * t; break
    case 'arc': u = distance * t; v = Math.sin(Math.PI * t) * amp * (def.curvature ?? 1); break
    case 'semicircle': u = (1 - Math.cos(Math.PI * t)) * amp; v = Math.sin(Math.PI * t) * amp; break
    case 'circle': case 'ellipse': u = Math.cos(2 * Math.PI * t) * amp; v = Math.sin(2 * Math.PI * t) * amp * (def.type === 'ellipse' ? def.curvature ?? .6 : 1); break
    case 'zigzag': u = distance * t; v = Math.sin(3 * Math.PI * t) * amp; break
    case 'bounce': u = Math.sin(2 * Math.PI * t) * amp; break
    case 'tap': u = Math.sin(Math.PI * t) ** 4 * distance; break
    case 'approach-contact': u = distance * smoothstep(Math.min(1, p / .65)); break
    case 'contact-release': u = distance * (1 - smoothstep(Math.max(0, (p - .35) / .65))); break
    case 'twist': twist = Math.sin(2 * Math.PI * t) * amp; break
  }
  const d = def.direction ?? [0, 0, 1], origin = def.origin ?? [0, 0, 0]
  const length = Math.hypot(...d) || 1
  // A perpendicular bend axis in the horizontal/vertical plane.
  const bend: Vec3 = Math.abs(d[1] / length) > .9 ? [1, 0, 0] : [0, 1, 0]
  return { offset: [origin[0] + d[0] / length * u + bend[0] * v,
    origin[1] + d[1] / length * u + bend[1] * v, origin[2] + d[2] / length * u + bend[2] * v], twist }
}
