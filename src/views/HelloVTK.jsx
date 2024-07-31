import React, { useRef, useEffect } from "react";
import vtkFullScreenRenderWindow from "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow";
import "@kitware/vtk.js/Rendering/Profiles/Geometry";
// Load the rendering pieces we want to use (for both WebGL and WebGPU)
// import "@kitware/vtk.js/Rendering/Profiles/Volume";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import vtkPlaneSource from "@kitware/vtk.js/Filters/Sources/PlaneSource";
//calculator
import vtkCalculator from "@kitware/vtk.js/Filters/General/Calculator";
import vtkDataSet from "@kitware/vtk.js/Common/DataModel/DataSet";
import vtkLookupTable from "@kitware/vtk.js/Common/Core/LookupTable";
import vtkWarpScalar from "@kitware/vtk.js/Filters/General/WarpScalar";
import { v23Mapper } from "../vtk2three/v23Mapper";

function HelloVTK() {
  const vtkContainerRef = useRef(null);

  useEffect(() => {
    const fullScreenRenderer = vtkFullScreenRenderWindow.newInstance({
      rootContainer: vtkContainerRef.current,
    });
    const renderer = fullScreenRenderer.getRenderer();
    const renderWindow = fullScreenRenderer.getRenderWindow();
    const lookupTable = vtkLookupTable.newInstance({
      hueRange: [0, 0.667],
    });
    lookupTable.setNumberOfColors(10);

    const { ColorMode, ScalarMode } = vtkMapper;
    const { FieldDataTypes } = vtkDataSet;

    const planeSource = vtkPlaneSource.newInstance({
      xResolution: 100,
      yResolution: 100,
    });

    const simpleFilter = vtkCalculator.newInstance();
    simpleFilter.setFormulaSimple(
      FieldDataTypes.POINT, // Generate an output array defined over points.
      [], // We don't request any point-data arrays because point coordinates are made available by default.
      "z", // Name the output array "z"
      (x) => (x[0] - 0.5) * (x[0] - 0.5) + (x[1] - 0.5) * (x[1] - 0.5) + 0.125
      // (x) => x[0]
    ); // Our formula for z

    const warpScalar = vtkWarpScalar.newInstance();
    const warpMapper = vtkMapper.newInstance({
      interpolateScalarsBeforeMapping: false,
      useLookupTableScalarRange: false,
      lookupTable,
    });

    // The generated 'z' array will become the default scalars, so the plane mapper will color by 'z':
    simpleFilter.setInputConnection(planeSource.getOutputPort());
    // We will also generate a surface whose points are displaced from the plane by 'z':
    warpScalar.setInputConnection(simpleFilter.getOutputPort());
    warpScalar.setInputArrayToProcess(0, "z", "PointData", "Scalars");
    warpMapper.setInputConnection(warpScalar.getOutputPort());

    const warpActor = vtkActor.newInstance();
    warpActor.getProperty().setEdgeVisibility(true);
    warpActor.setMapper(warpMapper);

    const calMapper = new v23Mapper();
    calMapper.setActor(warpActor);
    calMapper.getMeshData();
    
    renderer.addActor(warpActor);
    renderer.resetCamera();
    renderWindow.render();
  }, [vtkContainerRef]);

  return (
    <div
      ref={vtkContainerRef}
      style={{ position: "absolute", width: "100%", height: "100%" }}
    />
  );
}

export default HelloVTK;
