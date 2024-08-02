# Vtkjs to Three.js

a data pipeline from vtk render data to three render data base on vtkjs Source/Mapper/Filter...

## hello vtk to three

![hello vtk to three](/public/image/hellovtk2three.png)


## file structure

```
├── src
│   ├── routes
│   ├── threeView // for three rendering
│   │   └── main.js
│   ├── vtkView  // for vtk rendering
│   │   └── main.js
│   ├── views // all the viewpages
│   │   ├── HelloVTK2Three.jsx
│   │   └── ErrorPage.jsx
│   └── vtk2three // core of this project
│       ├── Core
│       │    ├── GeometryMapper.js
│       │    └── MaterialMapper.js
│       └── v23Mapper.js
└── package.json
```

## how to use

### main mapper code

```js
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
      // generate the three geometry
      const geo = geoMapper.mapGeometry();
      const matMapper = new MaterialMapper(this.actor.getProperty());
      // generate the three material
      const mat = matMapper.mapMaterial();
      // assemble the mesh
      const mesh = new Mesh(geo, mat);
      return mesh;
    }
  }
}
```
### 1. install

```
npm install
```

### 2. run

```
npm run start
```

### 3. visit the page

```
http://localhost:3000/hellovtk2three
```