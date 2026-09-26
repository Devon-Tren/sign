import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Vec3 } from '../clips'

// One coherent orientation basis, rather than interpolating palm and finger
// vectors independently. Reused scratch objects never escape these functions.
const x = new Vector3(), y = new Vector3(), z = new Vector3()
const matrix = new Matrix4(), a = new Quaternion(), b = new Quaternion()
export function wristQuaternion(palm: Vec3, point: Vec3, out = new Quaternion()) {
  y.set(...point).normalize()
  if (y.lengthSq() < .001) y.set(0, 1, 0)
  z.set(...palm).addScaledVector(y, -z.dot(y))
  if (z.lengthSq() < .001) {
    z.set(Math.abs(y.x) < .8 ? 1 : 0, Math.abs(y.x) < .8 ? 0 : 1, 0)
    z.addScaledVector(y, -z.dot(y))
  }
  z.normalize(); x.crossVectors(y, z).normalize()
  return out.setFromRotationMatrix(matrix.makeBasis(x, y, z))
}
export function blendOrientation(ap: Vec3, af: Vec3, bp: Vec3, bf: Vec3, t: number) {
  wristQuaternion(ap, af, a); wristQuaternion(bp, bf, b); a.slerp(b, t)
  z.set(0, 0, 1).applyQuaternion(a); y.set(0, 1, 0).applyQuaternion(a)
  return { palm: z.toArray() as unknown as Vec3, point: y.toArray() as unknown as Vec3 }
}
