import './style.css'

import * as THREE from 'three'

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'

import { CustomShaderMaterial } from 'three-custom-shader-material'

import * as CANNON from 'cannon-es'

import Stats from 'stats.js';

import Car from './world/car';





var stats = new Stats();

stats.showPanel( 0 ); // 0: fps, 1: ms, 2: mb, 3+: custom

document.body.appendChild( stats.dom );

/**

* Base

*/

// Canvas

const canvas = document.querySelector('canvas.webgl')

const scene = new THREE.Scene()

scene.fog = new THREE.Fog('#1e2230', 120, 700);

scene.background = null;





const world = new CANNON.World({

gravity: new CANNON.Vec3(0, -9.82, 0), // m/s²

})

world.broadphase = new CANNON.SAPBroadphase(world);

//cannonDebugger(scene, world.bodies, {color: 0x00ff00})



const car = new Car(scene, world);

car.init();



const bodyMaterial = new CANNON.Material();

const groundMaterial = new CANNON.Material();

const bodyGroundContactMaterial = new CANNON.ContactMaterial(

bodyMaterial,

groundMaterial,

{

friction: 0.8,

restitution: 0.02

}

)

world.addContactMaterial(bodyGroundContactMaterial)

world.defaultContactMaterial.friction = 0.6

world.defaultContactMaterial.restitution = 0.02



/**

* Lights

*/

const dirLight = new THREE.DirectionalLight('#ffe3ad', 1.8);

dirLight.position.set(-55, 85, -20);

dirLight.castShadow = true;

dirLight.shadow.camera.top = 420;

dirLight.shadow.camera.bottom = -420;

dirLight.shadow.camera.left = -420;

dirLight.shadow.camera.right = 420;

dirLight.shadow.camera.near = 0.1;

dirLight.shadow.camera.far = 900;

dirLight.shadow.mapSize.width = 4096;

dirLight.shadow.mapSize.height = 4096;

dirLight.shadow.bias = -0.00008;

scene.add(dirLight);

scene.add(dirLight.target);



const hemiLight = new THREE.HemisphereLight('#6f96ff', '#355c2e', 0.6)

scene.add(hemiLight)



const warmRimLight = new THREE.PointLight('#ffb06a', 1.25, 230, 2)

warmRimLight.position.set(22, 10, 45)

scene.add(warmRimLight)



const coolFillLight = new THREE.PointLight('#5a84ff', 0.65, 260, 2)

coolFillLight.position.set(-65, 14, -40)

scene.add(coolFillLight)





/**

* Cube Texture Loader

*/





/**

* Sizes

*/

const sizes = {

width: window.innerWidth,

height: window.innerHeight

}



let camera

let renderer



window.addEventListener('resize', () =>

{

// Update sizes

sizes.width = window.innerWidth

sizes.height = window.innerHeight



if (!camera || !renderer) {

return

}



// Update camera

camera.aspect = sizes.width / sizes.height

camera.updateProjectionMatrix()



// Update renderer

renderer.setSize(sizes.width, sizes.height)

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

})



/**

* Floor

*/

const gltfLoader = new GLTFLoader()

const textureLoader = new THREE.TextureLoader()

const setColorTextureEncoding = (texture) => {

// three r1xx uses encoding; newer versions use colorSpace.

if ('colorSpace' in texture) {

texture.colorSpace = 'srgb'

} else {

texture.encoding = THREE.sRGBEncoding

}

}



const createSurfaceTextures = (basePath, repeatX, repeatY, rotation) => {

const colorMap = textureLoader.load(`${basePath}_Color.jpg`)

const roughnessMap = textureLoader.load(`${basePath}_Roughness.jpg`)

const displacementMap = textureLoader.load(`${basePath}_Displacement.jpg`)

const aoMap = textureLoader.load(`${basePath}_AmbientOcclusion.jpg`)

const normalGLMap = textureLoader.load(`${basePath}_NormalGL.jpg`, () => {

textureSet.hasLoadedNormalGL = true

tryBuildCombinedNormalMap(textureSet)

})

const normalDXMap = textureLoader.load(`${basePath}_NormalDX.jpg`, () => {

textureSet.hasLoadedNormalDX = true

tryBuildCombinedNormalMap(textureSet)

})



const textureSet = {

colorMap,

roughnessMap,

displacementMap,

aoMap,

normalGLMap,

normalDXMap,

hasLoadedNormalGL: false,

hasLoadedNormalDX: false,

normalMap: normalGLMap,

materials: [],

repeatX,

repeatY,

rotation

}



setColorTextureEncoding(colorMap)

;[colorMap, roughnessMap, displacementMap, aoMap, normalGLMap, normalDXMap].forEach((texture) => {

texture.wrapS = THREE.RepeatWrapping

texture.wrapT = THREE.RepeatWrapping

texture.repeat.set(repeatX, repeatY)

texture.center.set(0.5, 0.5)

texture.rotation = rotation

})



return textureSet

}



const tryBuildCombinedNormalMap = (textureSet) => {

if (!textureSet.hasLoadedNormalGL || !textureSet.hasLoadedNormalDX || !textureSet.normalGLMap.image || !textureSet.normalDXMap.image) {

return

}



const width = textureSet.normalGLMap.image.width

const height = textureSet.normalGLMap.image.height

if (!width || !height) {

return

}



const glCanvas = document.createElement('canvas')

const dxCanvas = document.createElement('canvas')

const outCanvas = document.createElement('canvas')

glCanvas.width = dxCanvas.width = outCanvas.width = width

glCanvas.height = dxCanvas.height = outCanvas.height = height



const glCtx = glCanvas.getContext('2d')

const dxCtx = dxCanvas.getContext('2d')

const outCtx = outCanvas.getContext('2d')

if (!glCtx || !dxCtx || !outCtx) {

return

}



glCtx.drawImage(textureSet.normalGLMap.image, 0, 0)

dxCtx.drawImage(textureSet.normalDXMap.image, 0, 0)



const glData = glCtx.getImageData(0, 0, width, height)

const dxData = dxCtx.getImageData(0, 0, width, height)

const outData = outCtx.createImageData(width, height)



for (let i = 0; i < outData.data.length; i += 4) {

outData.data[i] = (glData.data[i] + dxData.data[i]) * 0.5

outData.data[i + 1] = (glData.data[i + 1] + (255 - dxData.data[i + 1])) * 0.5

outData.data[i + 2] = (glData.data[i + 2] + dxData.data[i + 2]) * 0.5

outData.data[i + 3] = 255

}



outCtx.putImageData(outData, 0, 0)

textureSet.normalMap = new THREE.CanvasTexture(outCanvas)

textureSet.normalMap.wrapS = THREE.RepeatWrapping

textureSet.normalMap.wrapT = THREE.RepeatWrapping

textureSet.normalMap.repeat.set(textureSet.repeatX, textureSet.repeatY)

textureSet.normalMap.center.set(0.5, 0.5)

textureSet.normalMap.rotation = textureSet.rotation

textureSet.normalMap.needsUpdate = true



textureSet.materials.forEach((material) => {

material.normalMap = textureSet.normalMap

material.normalScale.set(1.5, 1.5)

material.needsUpdate = true

})

}



const trackTextureSet = createSurfaceTextures('./textures/track/Asphalt025C_1K-JPG', 8, 8, Math.PI * 0.5)
const terrainTextureSet = createSurfaceTextures('./textures/terrain/Road015C_1K-JPG', 16, 16, 0)
const grassTextureSet = createSurfaceTextures('./textures/grass/Ground103_1K-JPG', 20, 20, 0)



const createTrackMaterial = (textureSet) => {

const material = new THREE.MeshStandardMaterial({

map: textureSet.colorMap,

color: new THREE.Color("#2a2a2b"),

roughnessMap: textureSet.roughnessMap,

displacementMap: textureSet.displacementMap,

aoMap: textureSet.aoMap,

normalMap: textureSet.normalMap,

normalScale: new THREE.Vector2(1.5, 1.5),

displacementScale: 0,

roughness: 1,

metalness: 0,

aoMapIntensity: 1,

side: THREE.DoubleSide,

})

textureSet.materials.push(material)

return material

}

const createTerrainMaterial = (textureSet) => {

const material = new THREE.MeshStandardMaterial({

map: textureSet.colorMap,

color: new THREE.Color('#ffffff'),

roughnessMap: textureSet.roughnessMap,

displacementMap: textureSet.displacementMap,

aoMap: textureSet.aoMap,

normalMap: textureSet.normalMap,

normalScale: new THREE.Vector2(1.2, 1.2),

displacementScale: 0,

roughness: 1,

metalness: 0,

aoMapIntensity: 0.6,

side: THREE.DoubleSide,

})

textureSet.materials.push(material)

return material

}



const createPoleMaterial = () => {

return new THREE.MeshStandardMaterial({

color: new THREE.Color('#8a9098'),

metalness: 0.7,

roughness: 0.35,

envMapIntensity: 0.9,

side: THREE.DoubleSide,

})

}

const createCageMaterial = () => {

return new THREE.MeshStandardMaterial({

color: new THREE.Color('#8f959d'),

metalness: 0.85,

roughness: 0.28,

envMapIntensity: 1.0,

side: THREE.DoubleSide,

})

}



const ensurePlanarUvForTerrain = (geometry) => {

if (!geometry || geometry.attributes.uv || !geometry.attributes.position) {

return

}



geometry.computeBoundingBox()

const bounds = geometry.boundingBox

if (!bounds) {

return

}



const size = new THREE.Vector3()

bounds.getSize(size)

const min = bounds.min

const position = geometry.attributes.position

const uv = new Float32Array(position.count * 2)



for (let i = 0; i < position.count; i++) {

const x = position.getX(i)

const z = position.getZ(i)

uv[i * 2] = size.x > 0 ? (x - min.x) / size.x : 0

uv[i * 2 + 1] = size.z > 0 ? (z - min.z) / size.z : 0

}



geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))

}



const hasTerrainMarker = (object) => {

let current = object

while (current) {

const currentName = (current.name || '').toLowerCase()
if (currentName.includes('terrain')) {

return true

}

current = current.parent

}



return false

}

const hasGrassMarker = (object) => {

let current = object

while (current) {

const currentName = (current.name || '').toLowerCase()
if (currentName.includes('grass')) {

return true

}

current = current.parent

}

return false

}

const hasPoleMarker = (object) => {

let current = object

while (current) {

const currentName = (current.name || '').toLowerCase()
if (currentName.includes('pole')) {

return true

}

current = current.parent

}

return false

}

const hasCageMarker = (object) => {

let current = object

while (current) {

const currentName = (current.name || '').toLowerCase()
if (currentName.includes('cage')) {

return true

}

current = current.parent

}

return false

}



const createCompoundStripeMaterial = () => {

return new CustomShaderMaterial({

baseMaterial: 'MeshStandardMaterial',

vShader: {

header: `

varying vec2 vUv;

`,

main: `

vUv = uv;

`

},

fShader: {

header: `

varying vec2 vUv;

`,

main: `

float stripeCount = 10.0;

float stripeIndex = floor(vUv.x * stripeCount);

float isWhite = mod(stripeIndex, 2.0);

vec3 redColor = vec3(0.84, 0.08, 0.08);

vec3 whiteColor = vec3(0.95, 0.95, 0.95);

csm_DiffuseColor = vec4(mix(redColor, whiteColor, isWhite), 1.0);

`

},

passthrough: {

side: THREE.DoubleSide,

metalness: 0.5,

roughness: 1.0

}

})

}



const createStaticColliderBodyFromMesh = (mesh) => {

if (!mesh.geometry) {

return null

}



mesh.geometry.computeBoundingBox()

const boundingBox = mesh.geometry.boundingBox

if (!boundingBox) {

return null

}



const localSize = new THREE.Vector3()

const localCenter = new THREE.Vector3()

boundingBox.getSize(localSize)

boundingBox.getCenter(localCenter)



const worldScale = new THREE.Vector3()

mesh.getWorldScale(worldScale)

const halfExtents = new CANNON.Vec3(

Math.abs(localSize.x * worldScale.x) * 0.5,

Math.abs(localSize.y * worldScale.y) * 0.5,

Math.abs(localSize.z * worldScale.z) * 0.5

)

// Flat meshes can have near-zero thickness; enforce minimum collider height.

halfExtents.y = Math.max(halfExtents.y, 0.12)



const worldCenter = localCenter.clone().applyMatrix4(mesh.matrixWorld)

const worldQuaternion = new THREE.Quaternion()

mesh.getWorldQuaternion(worldQuaternion)



const body = new CANNON.Body({ mass: 0, material: groundMaterial })

body.addShape(new CANNON.Box(halfExtents))

body.position.set(worldCenter.x, worldCenter.y, worldCenter.z)

body.quaternion.set(worldQuaternion.x, worldQuaternion.y, worldQuaternion.z, worldQuaternion.w)

body.updateAABB()

return body

}

const createPoleColliderBodyFromMesh = (mesh) => {

if (!mesh.geometry) {

return null

}

mesh.geometry.computeBoundingBox()

const boundingBox = mesh.geometry.boundingBox

if (!boundingBox) {

return null

}

const localSize = new THREE.Vector3()

const localCenter = new THREE.Vector3()

boundingBox.getSize(localSize)

boundingBox.getCenter(localCenter)

const worldScale = new THREE.Vector3()

mesh.getWorldScale(worldScale)

const worldSizeX = Math.abs(localSize.x * worldScale.x)
const worldSizeY = Math.abs(localSize.y * worldScale.y)
const worldSizeZ = Math.abs(localSize.z * worldScale.z)
const radius = Math.min(Math.max(Math.min(worldSizeX, worldSizeZ) * 0.14, 0.035), 0.18)
const height = Math.max(worldSizeY * 0.95, 0.35)

const worldCenter = localCenter.clone().applyMatrix4(mesh.matrixWorld)

const worldQuaternion = new THREE.Quaternion()

mesh.getWorldQuaternion(worldQuaternion)

const body = new CANNON.Body({ mass: 0, material: groundMaterial })

const cylinderShape = new CANNON.Cylinder(radius, radius, height, 12)
const cylinderOrientation = new CANNON.Quaternion()
// Cannon cylinders are X-aligned by default; rotate to stand upright on Y.
cylinderOrientation.setFromEuler(Math.PI * 0.5, 0, 0)
body.addShape(cylinderShape, new CANNON.Vec3(0, 0, 0), cylinderOrientation)

body.position.set(worldCenter.x, worldCenter.y, worldCenter.z)

body.quaternion.set(worldQuaternion.x, worldQuaternion.y, worldQuaternion.z, worldQuaternion.w)

body.updateAABB()

return body

}

const createCageColliderBodyFromMesh = (mesh) => {
  if (!mesh.geometry) return null
  mesh.geometry.computeBoundingBox()
  const boundingBox = mesh.geometry.boundingBox
  if (!boundingBox) return null

  const localSize = new THREE.Vector3()
  const localCenter = new THREE.Vector3()
  boundingBox.getSize(localSize)
  boundingBox.getCenter(localCenter)

  const worldScale = new THREE.Vector3()
  mesh.getWorldScale(worldScale)
  const worldSizeX = Math.abs(localSize.x * worldScale.x)
  const worldSizeY = Math.abs(localSize.y * worldScale.y)
  const worldSizeZ = Math.abs(localSize.z * worldScale.z)

  // Hard skip — anything this large is a scene-enclosing mesh, not a cage bar
  if (Math.max(worldSizeX, worldSizeZ) > 8) return null

  const halfExtents = new CANNON.Vec3(
    Math.max(worldSizeX * 0.5, 0.05),
    Math.max(worldSizeY * 0.5, 0.2),
    Math.max(worldSizeZ * 0.5, 0.05)
  )

  const worldCenter = localCenter.clone().applyMatrix4(mesh.matrixWorld)
  const worldQuaternion = new THREE.Quaternion()
  mesh.getWorldQuaternion(worldQuaternion)

  const body = new CANNON.Body({ mass: 0, material: groundMaterial })
  body.addShape(new CANNON.Box(halfExtents))
  body.position.set(worldCenter.x, worldCenter.y, worldCenter.z)
  body.quaternion.set(worldQuaternion.x, worldQuaternion.y, worldQuaternion.z, worldQuaternion.w)
  body.updateAABB()
  return body
}

const createPlaneSupportColliderFromMesh = (mesh) => {

if (!mesh.geometry) {

return null

}

mesh.geometry.computeBoundingBox()

const boundingBox = mesh.geometry.boundingBox

if (!boundingBox) {

return null

}

const localSize = new THREE.Vector3()

const localCenter = new THREE.Vector3()

boundingBox.getSize(localSize)

boundingBox.getCenter(localCenter)

const worldScale = new THREE.Vector3()

mesh.getWorldScale(worldScale)

const halfExtents = new CANNON.Vec3(

Math.max(Math.abs(localSize.x * worldScale.x) * 0.5, 0.5),

0.06,

Math.max(Math.abs(localSize.z * worldScale.z) * 0.5, 0.5)

)

const worldCenter = localCenter.clone().applyMatrix4(mesh.matrixWorld)

const worldQuaternion = new THREE.Quaternion()

mesh.getWorldQuaternion(worldQuaternion)

const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuaternion).normalize()
const supportCenter = worldCenter.clone().addScaledVector(worldUp, -0.08)

const body = new CANNON.Body({ mass: 0, material: groundMaterial })

body.addShape(new CANNON.Box(halfExtents))

// Place just under the rotated plane along its own normal.
body.position.set(supportCenter.x, supportCenter.y, supportCenter.z)

body.quaternion.set(worldQuaternion.x, worldQuaternion.y, worldQuaternion.z, worldQuaternion.w)

body.updateAABB()

return body

}



const createStaticTrimeshBodyFromMesh = (mesh) => {

const positionAttribute = mesh.geometry?.attributes?.position

if (!positionAttribute) {

return null

}



const source = positionAttribute.array

const vertices = new Float32Array(source.length)

const point = new THREE.Vector3()



for (let i = 0; i < source.length; i += 3) {

point.set(source[i], source[i + 1], source[i + 2]).applyMatrix4(mesh.matrixWorld)

vertices[i] = point.x

vertices[i + 1] = point.y

vertices[i + 2] = point.z

}



const rawIndices = mesh.geometry.index

? Array.from(mesh.geometry.index.array)

: Array.from({ length: source.length / 3 }, (_, i) => i)

const indices = []
const a = new THREE.Vector3()
const b = new THREE.Vector3()
const c = new THREE.Vector3()
const ab = new THREE.Vector3()
const ac = new THREE.Vector3()
const cross = new THREE.Vector3()
const minAreaSq = 1e-8

for (let i = 0; i < rawIndices.length; i += 3) {

const ia = rawIndices[i]
const ib = rawIndices[i + 1]
const ic = rawIndices[i + 2]

if (ia === undefined || ib === undefined || ic === undefined) {

continue

}

a.set(vertices[ia * 3], vertices[ia * 3 + 1], vertices[ia * 3 + 2])
b.set(vertices[ib * 3], vertices[ib * 3 + 1], vertices[ib * 3 + 2])
c.set(vertices[ic * 3], vertices[ic * 3 + 1], vertices[ic * 3 + 2])

ab.subVectors(b, a)
ac.subVectors(c, a)
cross.crossVectors(ab, ac)

if (cross.lengthSq() <= minAreaSq) {

continue

}

indices.push(ia, ib, ic)

}

if (indices.length < 3) {

return null

}



const body = new CANNON.Body({ mass: 0, material: groundMaterial })

body.addShape(new CANNON.Trimesh(Array.from(vertices), indices))

body.position.set(0, 0, 0)

body.quaternion.set(0, 0, 0, 1)

body.updateAABB()

return body

}



gltfLoader.load('./car/track.glb', (gltf) => {

const track = gltf.scene

track.scale.setScalar(50)
const spawnPoint = new THREE.Vector3(35.116717589755346, 3.2388459807938275, -481.6891406739944)

let hasPlaneSpawn = false
let hasMainPlaneCollider = false



let trackBounds = new THREE.Box3().setFromObject(track)

const trackSize = new THREE.Vector3()

trackBounds.getSize(trackSize)

if (trackSize.y > Math.max(trackSize.x, trackSize.z) * 0.35) {

track.rotation.x = -Math.PI * 0.5

}



track.updateMatrixWorld(true)

trackBounds = new THREE.Box3().setFromObject(track)

const trackCenter = new THREE.Vector3()

trackBounds.getCenter(trackCenter)

track.position.set(-trackCenter.x, -trackBounds.min.y, -trackCenter.z)

track.updateMatrixWorld(true)



track.traverse((object) => {

if (object.isMesh) {

const meshName = (object.name || '').toLowerCase()

object.receiveShadow = true

const isPlaneSurface = meshName.includes('plane')

const isTerrainSurface = hasTerrainMarker(object)
const isGrassSurface = hasGrassMarker(object)

const isCompoundSurface = meshName.includes('compound') || meshName.includes('compound.001')

const isPoleSurface = meshName.includes('pole') || hasPoleMarker(object)
const isCageSurface = meshName.includes('cage') || hasCageMarker(object)

object.castShadow = isCompoundSurface

if (isTerrainSurface || isGrassSurface) {

// Prevent full shadowing on terrain/grass with current light/shadow setup.

object.receiveShadow = false

}

if (isPlaneSurface && !hasPlaneSpawn) {

const planeBounds = new THREE.Box3().setFromObject(object)

const planeCenter = new THREE.Vector3()

planeBounds.getCenter(planeCenter)

spawnPoint.set(spawnPoint.x, planeBounds.max.y + 1.8, spawnPoint.z)

hasPlaneSpawn = true

}

if (isPlaneSurface || isTerrainSurface || isGrassSurface || isCompoundSurface || isPoleSurface || isCageSurface) {

if ((isTerrainSurface || isGrassSurface) && object.geometry) {

// Some imported terrain/grass meshes have invalid/missing normals and render black with PBR.

ensurePlanarUvForTerrain(object.geometry)

object.geometry.computeVertexNormals()

}

const hasUv = Boolean(object.geometry && object.geometry.attributes.uv)

if (hasUv && !object.geometry.attributes.uv2) {

object.geometry.setAttribute('uv2', object.geometry.attributes.uv)

}

const hasUv2 = Boolean(object.geometry && object.geometry.attributes.uv2)

if (Array.isArray(object.material)) {

object.material = object.material.map(() => (

isCompoundSurface

? createCompoundStripeMaterial()

: (isPoleSurface
? createPoleMaterial()
: (isCageSurface
? createCageMaterial()
: (isTerrainSurface
? createTerrainMaterial(terrainTextureSet)
: (isGrassSurface ? createTerrainMaterial(grassTextureSet) : createTrackMaterial(trackTextureSet)))))

))

} else {

object.material = isCompoundSurface

? createCompoundStripeMaterial()

: (isPoleSurface
? createPoleMaterial()
: (isCageSurface
? createCageMaterial()
: (isTerrainSurface
? createTerrainMaterial(terrainTextureSet)
: (isGrassSurface ? createTerrainMaterial(grassTextureSet) : createTrackMaterial(trackTextureSet)))))

}

}

if (isPlaneSurface || isCompoundSurface || isPoleSurface || isCageSurface) {

// Keep plane collider simple/stable; use detailed colliders for other meshes.

if (isPlaneSurface && hasMainPlaneCollider) {

return

}

const surfaceBody = isPlaneSurface

? createPlaneSupportColliderFromMesh(object)

: isPoleSurface

? createPoleColliderBodyFromMesh(object)

: isCageSurface

? createCageColliderBodyFromMesh(object)

: isCompoundSurface

? createStaticTrimeshBodyFromMesh(object) || createStaticColliderBodyFromMesh(object)

: createStaticColliderBodyFromMesh(object)

if (surfaceBody) {

world.addBody(surfaceBody)

if (isPlaneSurface) {

hasMainPlaneCollider = true

}

}

}

}

})



scene.add(track)

dirLight.target.position.set(spawnPoint.x, 0, spawnPoint.z)

dirLight.target.updateMatrixWorld()

car.setSpawnPoint(spawnPoint.x, spawnPoint.y, spawnPoint.z)


})



/**

* Camera

*/

// Base camera

camera = new THREE.PerspectiveCamera(50, sizes.width / sizes.height, 0.1, 10000)

camera.position.set(0, 2, -12)

scene.add(camera)



/**

* Renderer

*/

renderer = new THREE.WebGLRenderer({

canvas: canvas

})

renderer.outputEncoding = THREE.sRGBEncoding

renderer.shadowMap.enabled = true

renderer.shadowMap.type = THREE.PCFSoftShadowMap

renderer.toneMapping = THREE.ACESFilmicToneMapping

renderer.toneMappingExposure = 0.9

renderer.setSize(sizes.width, sizes.height)

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))



const pmremGenerator = new THREE.PMREMGenerator(renderer)

pmremGenerator.compileEquirectangularShader()

new EXRLoader().load('./hdri/EveningSkyHDRI030B_1K_HDR.exr', (exrTexture) => {

exrTexture.mapping = THREE.EquirectangularReflectionMapping

const envMap = pmremGenerator.fromEquirectangular(exrTexture).texture

scene.environment = envMap

scene.background = exrTexture

pmremGenerator.dispose()

}, undefined, (error) => {

console.error('Failed to load HDRI:', error)

scene.background = new THREE.Color('#1a2030')

})



/**

* Animate

*/

const timeStep = 1 / 60 // seconds

let lastCallTime

const cameraOffset = new THREE.Vector3(0, 2, -8)

const desiredCameraPosition = new THREE.Vector3()

const carWorldPosition = new THREE.Vector3()

const lookAtTarget = new THREE.Vector3()

const cameraSmoothness = 0.12



const tick = () =>

{

stats.begin();

const time = performance.now() / 1000 // seconds

if (!lastCallTime) {

world.step(timeStep)

} else {

const dt = Math.min(time - lastCallTime, 0.05)

world.step(timeStep, dt, 8)

}

lastCallTime = time



const chassisBody = car.car?.chassisBody

if (chassisBody) {

carWorldPosition.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)

desiredCameraPosition.copy(cameraOffset).applyQuaternion(chassisBody.quaternion).add(carWorldPosition)

camera.position.lerp(desiredCameraPosition, cameraSmoothness)

lookAtTarget.copy(carWorldPosition).add(new THREE.Vector3(0, 1.5, 0))

camera.lookAt(lookAtTarget)

}



// Render

renderer.render(scene, camera)

stats.end();



// Call tick again on the next frame

window.requestAnimationFrame(tick)

}



tick()