import React, { useRef, useEffect } from "react";

import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import vtkPlaneSource from "@kitware/vtk.js/Filters/Sources/PlaneSource";
//calculator
import vtkCalculator from "@kitware/vtk.js/Filters/General/Calculator";
import vtkDataSet from "@kitware/vtk.js/Common/DataModel/DataSet";
import vtkLookupTable from "@kitware/vtk.js/Common/Core/LookupTable";
import vtkWarpScalar from "@kitware/vtk.js/Filters/General/WarpScalar";
import { v23Mapper } from "../vtk2three/v23Mapper";
import ThreeView from "../threeView/main";
import VtkView from "../vtkView/main";

function HelloVTK2Three() {
  const vtkContainerRef = useRef(null);
  const threeContainerRef = useRef(null);

  useEffect(() => {
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
    // warpActor.getProperty().setEdgeVisibility(true);
    warpActor.setMapper(warpMapper);

    // vtk to three mapper
    const meshMapper = new v23Mapper();
    meshMapper.setActor(warpActor);
    const mesh = meshMapper.getMeshData();

    // three&vtk rendering part
    new ThreeView(threeContainerRef.current, mesh);
    new VtkView(vtkContainerRef.current, warpActor);
  }, []);

  return (
    <>
      <div
        ref={vtkContainerRef}
        style={{
          position: "absolute",
          width: "50%",
          height: "100%",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: "2px",
          left: "50%",
          height: "100%",
          backgroundColor: "white",
          zIndex: 82,
        }}
      ></div>
      <div
        ref={threeContainerRef}
        style={{
          position: "absolute",
          width: "50%",
          height: "100%",
          left: "50%",
        }}
      />
    </>
  );
}

export default HelloVTK2Three;
