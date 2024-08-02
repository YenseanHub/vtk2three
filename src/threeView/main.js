import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

export default class ThreeView {
  constructor(domElement, mesh) {
    const viewportWidth = (this.viewportWidth = domElement.offsetWidth);
    const viewportHeight = (this.viewportHeight = domElement.offsetHeight);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#52576e");
    this.camera = new THREE.PerspectiveCamera(
      45,
      viewportWidth / viewportHeight,
      1,
      1000
    );
    this.camera.position.z = 300;

    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setSize(viewportWidth, viewportHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    domElement.appendChild(this.renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);
    // direct light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.72);
    directionalLight.position.set(0, 0, 100);
    directionalLight.updateMatrixWorld();
    this.scene.add(directionalLight);
    // helper
    const axesHelper = new THREE.AxesHelper(20);
    this.scene.add(axesHelper);

    this.scene.add(mesh);

    const cameraControl = new OrbitControls(
      this.camera,
      this.renderer.domElement
    );
    cameraControl.addEventListener("change", (e) => {
      this.animate();
    });
    this.animate();
  }
  animate() {
    this.renderer.render(this.scene, this.camera);
  }
}
