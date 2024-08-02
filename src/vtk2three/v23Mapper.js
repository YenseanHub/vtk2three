import Constants from "@kitware/vtk.js/Rendering/Core/Mapper/Constants";
import { Mesh } from "three";
import { GeometryMapper } from "./Core/GeometryMapper";
import { MaterialMapper } from "./Core/MaterialMapper";

const { ColorMode } = Constants;
export class v23Mapper {
  constructor() {
    this.actor = null;
  }
  setActor(actor) {
    this.actor = actor;
    this.mapper = actor.getMapper();
  }
  getMeshData() {
    if (this.mapper) {
      // let bounds = this.mapper.getBounds();
      const geoMapper = new GeometryMapper(this.mapper);
      const geo = geoMapper.mapGeometry();
      const matMapper = new MaterialMapper(this.actor.getProperty());
      const mat = matMapper.mapMaterial();
      const mesh = new Mesh(geo, mat);
      return mesh;
    }
  }
}
