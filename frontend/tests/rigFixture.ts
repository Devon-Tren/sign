import fs from 'node:fs/promises'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { loadSigner } from '../src/signerRig'

/** Bundle test entries to frontend/node_modules/.cache/*.mjs. Image loading
 * alone is stubbed; the same FBX, calibration and production rig are used. */
export async function loadTestSigner() {
  const textureLoad = THREE.TextureLoader.prototype.load
  const modelLoad = FBXLoader.prototype.loadAsync
  const oldWindow = globalThis.window
  Object.assign(globalThis, { window: { URL } })
  THREE.TextureLoader.prototype.load = function () { return new THREE.Texture() }
  FBXLoader.prototype.loadAsync = async function () {
    const data = await fs.readFile(new URL('../../public/avatar/signer.fbx', import.meta.url))
    return this.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
  }
  try { return await loadSigner() } finally {
    THREE.TextureLoader.prototype.load = textureLoad
    FBXLoader.prototype.loadAsync = modelLoad
    Object.assign(globalThis, { window: oldWindow })
  }
}
