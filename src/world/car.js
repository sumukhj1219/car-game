import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export default class Car {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;

        this.car = {};
        this.chassis = {};
        this.wheels = [];
        this.chassisDimension = {
            x: 1.96,
            y: 1,
            z: 4.3
        };
        this.chassisModelPos = {
            x: 0,
            y: -0.629999999999999,
            z: 0
        };
        this.wheelScale = {
            frontWheel: 1.1,
            hindWheel: 1.1
        };
        this.mass = 250;
        this.spawnPoint = new CANNON.Vec3(0, 4, 0);
        this.spawnHeightOffset = 0.35;
        this.spawnYaw = -Math.PI * 0.5;
        this.processControls = null;
        this.currentSteer = 0;
        this.currentThrottle = 0;

        // Track key state as a plain object for reliable reads each physics step
        this.keysPressed = new Set();
    }

    init() {
        this.loadModels();
        this.setChassis();
        this.setWheels();
        this.controls();
        // Set spawn point AFTER chassis is created so the body exists
        this.setSpawnPoint(this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z);
        this.update();
    }

    loadModels() {
        const gltfLoader = new GLTFLoader();
        const dracoLoader = new DRACOLoader();

        dracoLoader.setDecoderConfig({ type: 'js' });
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');

        gltfLoader.setDRACOLoader(dracoLoader);

        gltfLoader.load('./car/chassis.gltf', gltf => {
            this.chassis = gltf.scene;
            this.chassis.traverse(object => {
                if (object.isMesh) {
                    object.castShadow = true;
                    object.material = new THREE.MeshStandardMaterial({
                        color: 'white',
                        metalness: 0.5,
                        roughness: 0.5,
                    });
                }
            });
            this.scene.add(this.chassis);
        });

        // Pre-fill so indices are reserved — GLTF callbacks may resolve out of order
        this.wheels = [null, null, null, null];
        for (let i = 0; i < 4; i++) {
            const slotIndex = i; // capture before async boundary
            gltfLoader.load('./car/wheel.gltf', gltf => {
                const model = gltf.scene;
                this.wheels[slotIndex] = model;
                // Wheels 1 and 3 are on the left side — mirror them
                if (slotIndex === 1 || slotIndex === 3) {
                    model.scale.set(
                        -1 * this.wheelScale.frontWheel,
                        1  * this.wheelScale.frontWheel,
                        -1 * this.wheelScale.frontWheel
                    );
                } else {
                    model.scale.set(
                        1 * this.wheelScale.frontWheel,
                        1 * this.wheelScale.frontWheel,
                        1 * this.wheelScale.frontWheel
                    );
                }
                this.scene.add(model);
            });
        }
    }

    setChassis() {
        const chassisShape = new CANNON.Box(
            new CANNON.Vec3(
                this.chassisDimension.x * 0.5,
                this.chassisDimension.y * 0.5,
                this.chassisDimension.z * 0.5
            )
        );

        // Use a single shared material for the chassis so friction is consistent
        const chassisMaterial = new CANNON.Material({ friction: 0 });
        const chassisBody = new CANNON.Body({ mass: this.mass, material: chassisMaterial });
        chassisBody.addShape(chassisShape);

        // Damping — linear keeps the car from sliding forever; angular prevents
        // indefinite spin after a collision
        chassisBody.linearDamping = 0.16;
        chassisBody.angularDamping = 0.28;

        this.car = new CANNON.RaycastVehicle({
            chassisBody,
            indexRightAxis: 0,
            indexUpAxis: 1,
            indexForwardAxis: 2,
        });

        this.car.addToWorld(this.world);
    }

    setWheels() {
        this.car.wheelInfos = [];

        // FIX: All four addWheel calls use the correct radius (0.35) and tuning
        // FIX: Wheel bodies are now created AND added to the world so they
        //      participate in collision detection properly.

        const wheelMaterial = new CANNON.Material({ friction: 0 });

        const addWheel = (options) => {
            this.car.addWheel(options);

            // Build the collision body for this wheel index
            const wheelIndex = this.car.wheelInfos.length - 1;
            const wheel = this.car.wheelInfos[wheelIndex];
            const cylinderShape = new CANNON.Cylinder(
                wheel.radius,
                wheel.radius,
                wheel.radius / 2,
                20
            );
            const wheelBody = new CANNON.Body({ mass: 1, material: wheelMaterial });
            // Rotate the cylinder so its axis aligns with the wheel axle (X axis)
            const q = new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0);
            wheelBody.addShape(cylinderShape, new CANNON.Vec3(), q);
            // Disable collisions between wheel bodies so they don't fight the
            // raycast suspension logic
            wheelBody.collisionFilterGroup = 0;
            wheelBody.collisionFilterMask = 0;
            this.world.addBody(wheelBody);
        };

        // Front-left (index 0)
        addWheel({
            radius: 0.35,
            directionLocal: new CANNON.Vec3(0, -1, 0),
            suspensionStiffness: 55,
            suspensionRestLength: 0.45,
            frictionSlip: 6.5,
            dampingRelaxation: 2.3,
            dampingCompression: 2.8,
            maxSuspensionForce: 12000,
            rollInfluence: 0.08,
            axleLocal: new CANNON.Vec3(-1, 0, 0),
            chassisConnectionPointLocal: new CANNON.Vec3(0.75, 0.1, -1.32),
            maxSuspensionTravel: 0.35,
        });

        // Front-right (index 1)
        addWheel({
            radius: 0.35,
            directionLocal: new CANNON.Vec3(0, -1, 0),
            suspensionStiffness: 55,
            suspensionRestLength: 0.45,
            frictionSlip: 6.5,
            dampingRelaxation: 2.3,
            dampingCompression: 2.8,
            maxSuspensionForce: 12000,
            rollInfluence: 0.08,
            axleLocal: new CANNON.Vec3(-1, 0, 0),
            chassisConnectionPointLocal: new CANNON.Vec3(-0.78, 0.1, -1.32),
            maxSuspensionTravel: 0.35,
        });

        // Rear-left (index 2)
        addWheel({
            radius: 0.35,
            directionLocal: new CANNON.Vec3(0, -1, 0),
            suspensionStiffness: 55,
            suspensionRestLength: 0.45,
            frictionSlip: 8.5,
            dampingRelaxation: 2.4,
            dampingCompression: 2.9,
            maxSuspensionForce: 12500,
            rollInfluence: 0.1,
            axleLocal: new CANNON.Vec3(-1, 0, 0),
            chassisConnectionPointLocal: new CANNON.Vec3(0.75, 0.1, 1.25),
            maxSuspensionTravel: 0.35,
        });

        // Rear-right (index 3)
        addWheel({
            radius: 0.35,
            directionLocal: new CANNON.Vec3(0, -1, 0),
            suspensionStiffness: 55,
            suspensionRestLength: 0.45,
            frictionSlip: 8.5,
            dampingRelaxation: 2.4,
            dampingCompression: 2.9,
            maxSuspensionForce: 12500,
            rollInfluence: 0.1,
            axleLocal: new CANNON.Vec3(-1, 0, 0),
            chassisConnectionPointLocal: new CANNON.Vec3(-0.78, 0.1, 1.25),
            maxSuspensionTravel: 0.35,
        });
    }

    controls() {
        const maxSteerVal = 0.68;
        const maxForce = 1800;          // N — tuned for responsive accel without wheel hop
        const reverseForceScale = 0.72;
        const serviceBrakeForce = 14;
        const coastBrake = 0.01;        // very light drag so lift-off doesn't destabilize the chassis
        const fixedDt = 1 / 60;
        const steerResponse = 24;
        const throttleResponse = 12;    // was 7 — snappier throttle pickup

        // Register key state — only track presses, not physics logic here
        window.addEventListener('keydown', (e) => {
            this.keysPressed.add(e.key.toLowerCase());
            // Reset can fire immediately on keydown
            if (e.key.toLowerCase() === 'r') this.resetCar();
        });
        window.addEventListener('keyup', (e) => {
            this.keysPressed.delete(e.key.toLowerCase());
        });

        // FIX: All control logic — including steer/throttle lerp — now runs
        // inside processControls, which is called every physics step (postStep).
        // Previously, the lerp only advanced on keydown/keyup events, meaning
        // steering never smoothly interpolated between steps.
        this.processControls = () => {
            const speed = this.car.chassisBody.velocity.length() * 3.6; // km/h
            const steerLimit = maxSteerVal;

            const forward   = this.keysPressed.has('w') || this.keysPressed.has('arrowup');
            const reverse   = this.keysPressed.has('s') || this.keysPressed.has('arrowdown');
            const handbrake = this.keysPressed.has(' ');

            const targetThrottle = (forward ? 1 : 0) + (reverse ? -1 : 0);
            this.currentThrottle += (targetThrottle - this.currentThrottle) *
                Math.min(1, throttleResponse * fixedDt);

            const left  = this.keysPressed.has('a') || this.keysPressed.has('arrowleft');
            const right = this.keysPressed.has('d') || this.keysPressed.has('arrowright');
            const targetSteerInput = (left ? 1 : 0) + (right ? -1 : 0);
            const targetSteer = targetSteerInput * steerLimit;

            // Lerp per physics step — smooth regardless of frame-rate
            this.currentSteer += (targetSteer - this.currentSteer) *
                Math.min(1, steerResponse * fixedDt);

            // Wheel order is rear (0,1) then front (2,3) in this rig.
            // Keep rear wheels straight and steer only the front axle.
            this.car.setSteeringValue(0, 0);
            this.car.setSteeringValue(0, 1);
            this.car.setSteeringValue(this.currentSteer, 2);
            this.car.setSteeringValue(this.currentSteer, 3);

            if (handbrake) {
                this.clearEngineForce();
                // Space now behaves like a regular brake on all wheels.
                this.car.setBrake(serviceBrakeForce, 0);
                this.car.setBrake(serviceBrakeForce, 1);
                this.car.setBrake(serviceBrakeForce, 2);
                this.car.setBrake(serviceBrakeForce, 3);
                return;
            }

            if (Math.abs(this.currentThrottle) > 0.02) {
                this.car.setBrake(0, 0);
                this.car.setBrake(0, 1);
                this.car.setBrake(0, 2);
                this.car.setBrake(0, 3);

                // Front wheels free-wheel (0 engine force)
                this.car.applyEngineForce(0, 0);
                this.car.applyEngineForce(0, 1);

                // FIX: Sign convention — positive engine force moves the car
                // forward in CANNON's RaycastVehicle when indexForwardAxis=2.
                // Throttle > 0 is forward, < 0 is reverse.
                const engineSign  = this.currentThrottle > 0 ? -1 : 1;
                const reverseScale = this.currentThrottle > 0 ? 1 : reverseForceScale;
                const driveForce  = maxForce * Math.abs(this.currentThrottle) * reverseScale * engineSign;

                // Rear-wheel drive (0,1). Front wheels (2,3) are steering wheels.
                this.car.applyEngineForce(driveForce, 0);
                this.car.applyEngineForce(driveForce, 1);
            } else {
                this.clearEngineForce();
                // Coast braking on all four wheels when no throttle input
                this.car.setBrake(coastBrake, 0);
                this.car.setBrake(coastBrake, 1);
                this.car.setBrake(coastBrake, 2);
                this.car.setBrake(coastBrake, 3);
            }

            // Chassis stabilization: damp roll/pitch spin a bit each physics step.
            // Keeps lift-off turns from tripping the car while preserving yaw feel.
            this.car.chassisBody.angularVelocity.x *= 0.94;
            this.car.chassisBody.angularVelocity.z *= 0.94;
        };
    }

    clearEngineForce() {
        this.car.applyEngineForce(0, 0);
        this.car.applyEngineForce(0, 1);
        this.car.applyEngineForce(0, 2);
        this.car.applyEngineForce(0, 3);
    }

    resetCar() {
        this.setSpawnPoint(this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z);
    }

    update() {
        this.world.addEventListener('postStep', () => {
            // FIX: processControls is called every physics step so steering and
            // throttle lerp advance at a consistent 60 Hz regardless of input events.
            if (this.processControls) {
                this.processControls();
            }
            
            console.log(this.car.chassisBody.position)
            const chassisReady =
                this.car.wheelInfos &&
                this.chassis.position &&
                this.wheels[0] &&
                this.wheels[0].position;

            if (!chassisReady) return;

            // Sync Three.js chassis mesh to Cannon body
            this.chassis.position.set(
                this.car.chassisBody.position.x + this.chassisModelPos.x,
                this.car.chassisBody.position.y + this.chassisModelPos.y,
                this.car.chassisBody.position.z + this.chassisModelPos.z
            );
            this.chassis.quaternion.copy(this.car.chassisBody.quaternion);

            // Sync wheel meshes
            for (let i = 0; i < 4; i++) {
                if (this.car.wheelInfos[i] && this.wheels[i]) {
                    this.car.updateWheelTransform(i);
                    this.wheels[i].position.copy(
                        this.car.wheelInfos[i].worldTransform.position
                    );
                    this.wheels[i].quaternion.copy(
                        this.car.wheelInfos[i].worldTransform.quaternion
                    );
                }
            }
        });
    }

    setSpawnPoint(x, y, z) {
        // Raycast downward to find the ground so the car doesn't start floating
        const from = new CANNON.Vec3(x, y + 20, z);
        const to   = new CANNON.Vec3(x, y - 200, z);
        const hit  = new CANNON.RaycastResult();
        let correctedY = y + this.spawnHeightOffset;

        if (this.world.raycastClosest(from, to, {}, hit)) {
            correctedY = hit.hitPointWorld.y + this.spawnHeightOffset;
        }

        this.spawnPoint.set(x, correctedY, z);

        if (!this.car?.chassisBody) return;

        this.car.chassisBody.position.set(x, correctedY, z);
        this.car.chassisBody.quaternion.setFromEuler(0, this.spawnYaw, 0);
        this.car.chassisBody.velocity.set(0, 0, 0);
        this.car.chassisBody.angularVelocity.set(0, 0, 0);

        // FIX: Also zero out current steering/throttle state on reset so the
        // car doesn't resume mid-throttle after being teleported.
        this.currentSteer    = 0;
        this.currentThrottle = 0;
        this.clearEngineForce();
        for (let i = 0; i < 4; i++) this.car.setBrake(0, i);
    }
}