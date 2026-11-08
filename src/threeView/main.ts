import * as THREE from "three";
import type { Object3D } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export default class ThreeView {
  private readonly viewportWidth: number;
  private readonly viewportHeight: number;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly cameraControl: OrbitControls;
  private readonly onChange: () => void;

  constructor(domElement: HTMLElement, object: Object3D) {
    this.viewportWidth = domElement.offsetWidth;
    this.viewportHeight = domElement.offsetHeight;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#52576e");
    this.camera = new THREE.PerspectiveCamera(
      45,
      this.viewportWidth / this.viewportHeight,
      0.0001,
      1000
    );

    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setSize(this.viewportWidth, this.viewportHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    domElement.appendChild(this.renderer.domElement);

    // three r155+ uses physically correct lights: legacy intensities (r152)
    // must be scaled by PI to keep the same brightness as the vtk view.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7 * Math.PI));
    const directionalLight = new THREE.DirectionalLight(
      0xffffff,
      0.72 * Math.PI
    );
    directionalLight.updateMatrixWorld();
    this.scene.add(directionalLight);
    this.scene.add(object);

    // Fit the camera to the converted object graph (Group / Mesh / Points).
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object);
    const sphere = box.isEmpty()
      ? new THREE.Sphere(new THREE.Vector3(), 1)
      : box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.001);
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const distance = (radius / Math.sin(halfFov)) * 1.3;
    this.camera.position
      .copy(sphere.center)
      .add(new THREE.Vector3(0, 0, distance));
    this.camera.near = Math.max(distance / 1000, 0.0001);
    this.camera.far = distance + radius * 10;
    this.camera.updateProjectionMatrix();
    directionalLight.position.set(0, 0, distance);

    this.scene.add(new THREE.AxesHelper(radius * 0.8));

    this.cameraControl = new OrbitControls(
      this.camera,
      this.renderer.domElement
    );
    this.cameraControl.target.copy(sphere.center);
    this.cameraControl.update();
    this.onChange = () => this.animate();
    this.cameraControl.addEventListener("change", this.onChange);
    this.animate();
  }

  animate(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.cameraControl.removeEventListener("change", this.onChange);
    this.cameraControl.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
