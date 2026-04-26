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
            y: 0,
            z: 0
        };
        this.wheelScale = {
            frontWheel: 1.1,
            hindWheel: 1.5
        };
        this.wheelVisualInset = 0;
        this.wheelVisualHeightOffset = -0.1;
        this.wheelVisualForwardOffset = 0;
        this.mass = 250;
        this.spawnPoint = new CANNON.Vec3(0, 4, 0);
        this.spawnHeightOffset = 0.15;
        this.spawnYaw = -Math.PI * 0.5;
        this.modelYawOffset = 0;
        this.chassisModelRotationOffset = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            this.modelYawOffset
        );
        this.wheelModelRotationOffset = new THREE.Quaternion();
        this.wheelSideFlipOffset = new THREE.Quaternion();
        this.chassisInitialWorldPosition = null;
        this.chassisInitialWorldQuaternion = null;
        this.chassisVisualOffsetLocal = new THREE.Vector3();
        this.chassisVisualRotationOffset = new THREE.Quaternion();
        this.hasCalibratedChassisTransform = false;
        this.wheelInitialWorldPositions = [null, null, null, null];
        this.wheelInitialWorldQuaternions = [null, null, null, null];
        this.wheelVisualOffsetsLocal = [null, null, null, null];
        this.wheelVisualRotationOffsets = [null, null, null, null];
        this.hasCalibratedWheelOffsets = false;
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

        const normalizeName = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const findNodeByName = (nodes, name) => {
            const target = normalizeName(name);
            return nodes.find((node) => normalizeName(node.name) === target) || null;
        };

        gltfLoader.load('./car/car.glb', (gltf) => {
            const carRoot = gltf.scene;
            carRoot.updateMatrixWorld(true);
            const nodes = [];
            carRoot.traverse((object) => {
                nodes.push(object);
                if (object.isMesh) {
                    object.castShadow = true;
                    object.receiveShadow = true;
                    if (Array.isArray(object.material)) {
                        object.material.forEach((material) => {
                            if (material) material.needsUpdate = true;
                        });
                    } else if (object.material) {
                        object.material.needsUpdate = true;
                    }
                }
            });

            this.wheels = [null, null, null, null];
            this.wheelInitialWorldPositions = [null, null, null, null];
            this.wheelInitialWorldQuaternions = [null, null, null, null];
            this.wheelVisualOffsetsLocal = [null, null, null, null];
            this.wheelVisualRotationOffsets = [null, null, null, null];
            this.hasCalibratedWheelOffsets = false;
            this.chassisInitialWorldPosition = null;
            this.chassisInitialWorldQuaternion = null;
            this.chassisVisualOffsetLocal.set(0, 0, 0);
            this.chassisVisualRotationOffset.identity();
            this.hasCalibratedChassisTransform = false;

            const wheelNodeNames = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];
            for (let i = 0; i < 4; i++) {
                const wheelNode = findNodeByName(nodes, wheelNodeNames[i]);
                if (!wheelNode) continue;
                this.wheels[i] = wheelNode;
                this.wheelInitialWorldPositions[i] = wheelNode.getWorldPosition(new THREE.Vector3());
                this.wheelInitialWorldQuaternions[i] = wheelNode.getWorldQuaternion(new THREE.Quaternion());
                this.scene.attach(wheelNode);
            }

            const chassisNode = findNodeByName(nodes, 'chassis') || findNodeByName(nodes, 'Chassis') || carRoot;
            this.chassis = chassisNode;
            this.scene.attach(this.chassis);
            this.chassisInitialWorldPosition = this.chassis.getWorldPosition(new THREE.Vector3());
            this.chassisInitialWorldQuaternion = this.chassis.getWorldQuaternion(new THREE.Quaternion());
        }, undefined, (error) => {
            console.error('Failed to load ./car/car.glb', error);
        });
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

            const targetThrottle = (forward ? -1 : 0) + (reverse ? 1 : 0);
            this.currentThrottle += (targetThrottle - this.currentThrottle) *
                Math.min(1, throttleResponse * fixedDt);

            const left  = this.keysPressed.has('a') || this.keysPressed.has('arrowleft');
            const right = this.keysPressed.has('d') || this.keysPressed.has('arrowright');
            const targetSteerInput = (left ? 1 : 0) + (right ? -1 : 0);
            const targetSteer = targetSteerInput * steerLimit;

            // Lerp per physics step — smooth regardless of frame-rate
            this.currentSteer += (targetSteer - this.currentSteer) *
                Math.min(1, steerResponse * fixedDt);

            // Wheel order in this rig is front (0,1) then rear (2,3).
            // Keep rear wheels straight and steer only the front axle.
            this.car.setSteeringValue(this.currentSteer, 0);
            this.car.setSteeringValue(this.currentSteer, 1);
            this.car.setSteeringValue(0, 2);
            this.car.setSteeringValue(0, 3);

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

                // Rear-wheel drive (2,3). Front wheels (0,1) are steering wheels.
                this.car.applyEngineForce(driveForce, 2);
                this.car.applyEngineForce(driveForce, 3);
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
            
            const chassisReady =
                this.car.wheelInfos &&
                this.chassis.position &&
                this.wheels[0] &&
                this.wheels[0].position;

            if (!chassisReady) return;

            // Sync Three.js chassis mesh to Cannon body
            const chassisBodyPosition = new THREE.Vector3(
                this.car.chassisBody.position.x,
                this.car.chassisBody.position.y,
                this.car.chassisBody.position.z
            );
            const chassisBodyQuaternion = new THREE.Quaternion(
                this.car.chassisBody.quaternion.x,
                this.car.chassisBody.quaternion.y,
                this.car.chassisBody.quaternion.z,
                this.car.chassisBody.quaternion.w
            );

            if (!this.hasCalibratedChassisTransform && this.chassisInitialWorldPosition && this.chassisInitialWorldQuaternion) {
                const chassisWorldOffset = this.chassisInitialWorldPosition.clone().sub(chassisBodyPosition);
                this.chassisVisualOffsetLocal.copy(
                    chassisWorldOffset.applyQuaternion(chassisBodyQuaternion.clone().invert())
                );
                this.chassisVisualRotationOffset.copy(
                    chassisBodyQuaternion.clone().invert().multiply(this.chassisInitialWorldQuaternion)
                );
                this.hasCalibratedChassisTransform = true;
            }

            const manualChassisOffset = new THREE.Vector3(
                this.chassisModelPos.x,
                this.chassisModelPos.y,
                this.chassisModelPos.z
            );
            const combinedChassisLocalOffset = this.chassisVisualOffsetLocal.clone().add(manualChassisOffset);
            const combinedChassisWorldOffset = combinedChassisLocalOffset.applyQuaternion(chassisBodyQuaternion);
            this.chassis.position.copy(chassisBodyPosition.add(combinedChassisWorldOffset));
            this.chassis.quaternion
                .copy(chassisBodyQuaternion)
                .multiply(this.chassisVisualRotationOffset)
                .multiply(this.chassisModelRotationOffset);

            // Sync wheel meshes
            for (let i = 0; i < 4; i++) {
                if (this.car.wheelInfos[i] && this.wheels[i]) {
                    this.car.updateWheelTransform(i);
                    const wheelPhysicsPosition = this.car.wheelInfos[i].worldTransform.position;
                    const wheelPhysicsPositionThree = new THREE.Vector3(
                        wheelPhysicsPosition.x,
                        wheelPhysicsPosition.y,
                        wheelPhysicsPosition.z
                    );
                    this.wheels[i].position.copy(wheelPhysicsPositionThree);

                    if (!this.hasCalibratedWheelOffsets && this.wheelInitialWorldPositions[i]) {
                        const worldOffset = this.wheelInitialWorldPositions[i].clone().sub(wheelPhysicsPositionThree);
                        const localOffset = worldOffset.applyQuaternion(chassisBodyQuaternion.clone().invert());
                        this.wheelVisualOffsetsLocal[i] = localOffset;
                    }

                    const wheelPhysicsQuaternion = new THREE.Quaternion(
                        this.car.wheelInfos[i].worldTransform.quaternion.x,
                        this.car.wheelInfos[i].worldTransform.quaternion.y,
                        this.car.wheelInfos[i].worldTransform.quaternion.z,
                        this.car.wheelInfos[i].worldTransform.quaternion.w
                    );

                    if (!this.hasCalibratedWheelOffsets && this.wheelInitialWorldQuaternions[i]) {
                        this.wheelVisualRotationOffsets[i] = wheelPhysicsQuaternion
                            .clone()
                            .invert()
                            .multiply(this.wheelInitialWorldQuaternions[i]);
                    }

                    const side = Math.sign(this.car.wheelInfos[i].chassisConnectionPointLocal.x) || 0;
                    if (side !== 0 || this.wheelVisualHeightOffset !== 0 || this.wheelVisualForwardOffset !== 0 || this.wheelVisualOffsetsLocal[i]) {
                        const localVisualOffset = (this.wheelVisualOffsetsLocal[i] || new THREE.Vector3()).clone().add(
                            new THREE.Vector3(
                                -side * this.wheelVisualInset,
                                this.wheelVisualHeightOffset,
                                this.wheelVisualForwardOffset
                            )
                        );
                        const worldOffset = localVisualOffset.applyQuaternion(chassisBodyQuaternion);
                        this.wheels[i].position.add(worldOffset);
                    }
                    this.wheels[i].quaternion
                        .copy(wheelPhysicsQuaternion)
                        .multiply(this.wheelVisualRotationOffsets[i] || new THREE.Quaternion())
                        .multiply(this.wheelModelRotationOffset);
                }
            }
            if (!this.hasCalibratedWheelOffsets) {
                const allPositionOffsetsReady = this.wheelVisualOffsetsLocal.every((offset) => Boolean(offset));
                const allRotationOffsetsReady = this.wheelVisualRotationOffsets.every((offset) => Boolean(offset));
                this.hasCalibratedWheelOffsets = allPositionOffsetsReady && allRotationOffsetsReady;
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