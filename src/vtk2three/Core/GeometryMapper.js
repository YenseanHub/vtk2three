import { BufferGeometry, BufferAttribute } from "three";

export class GeometryMapper {
  constructor(vtkMapper) {
    this.vtkMapper = vtkMapper;
    this.vtkPolyData = this.vtkMapper.getInputData();
  }
  mapGeometry() {
    // map geometry from vtkPolyData to three.js geometry
    if (this.vtkPolyData.getNumberOfPoints() > 0) {
      const geometry = new BufferGeometry();
      // vertices
      const vertices = this.vtkPolyData.getPoints().getData();
      for (let index = 0; index < vertices.length; index++) {
        vertices[index] *= 100.0;
      }
      geometry.setAttribute("position", new BufferAttribute(vertices, 3));
      // indexes
      const indices = this.vtkPolyData.getPolys().getData();
      // 5 to 3
      const groupCount = indices.length / 5;
      const newIndices = new Uint16Array(2 * 3 * groupCount);
      for (let index = 0; index < groupCount; ++index) {
        newIndices[6 * index] = indices[5 * index + 1];
        newIndices[6 * index + 1] = indices[5 * index + 2];
        newIndices[6 * index + 2] = indices[5 * index + 3];
        newIndices[6 * index + 3] = indices[5 * index + 1];
        newIndices[6 * index + 4] = indices[5 * index + 3];
        newIndices[6 * index + 5] = indices[5 * index + 4];
      }
      // console.log(newIndices);
      geometry.setIndex(new BufferAttribute(newIndices, 1));
      // normals
      const normals = this.vtkPolyData.getPointData().getNormals().getData();
      geometry.setAttribute("normal", new BufferAttribute(normals, 3));
      // colors
      this.vtkMapper.mapScalars(this.vtkPolyData, 1.0);
      const color = this.vtkMapper.getColorMapColors().getData();
      // transform 0-255 to 0-1 format
      const colorCount = color.length / 4;
      const newColors = new Float32Array(3 * colorCount);
      for (let index = 0; index < colorCount; index++) {
        newColors[3 * index] = this.sRGBToLinear(color[4 * index] / 255.0);
        newColors[3 * index + 1] = this.sRGBToLinear(
          color[4 * index + 1] / 255.0
        );
        newColors[3 * index + 2] = this.sRGBToLinear(
          color[4 * index + 2] / 255.0
        );
      }
      //   for (let index = 0; index <  color.length; index++) {
      //     color[index] /=  255.0;
      //   }
      // console.log(color);
      // console.log(newColors);
      geometry.setAttribute("color", new BufferAttribute(newColors, 3));
      //   geometry.setAttribute("color", new BufferAttribute(color, 4));
      return geometry;
    }
  }
  sRGBToLinear(c) {
    return c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
}
