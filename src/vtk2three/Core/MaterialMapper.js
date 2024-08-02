import { MeshBasicMaterial, MeshLambertMaterial } from "three";

export class MaterialMapper {
  constructor(vtkProperty) {
    this.vtkProperty = vtkProperty;
  }
  mapMaterial() {
    // Implement material mapping
    let material = new MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
      side: 2,
    });
    // let material = new MeshBasicMaterial({
    //   color: 0xffffff,
    //   vertexColors: true,
    // });
    return material;
  }
}
