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