import { useEffect, useRef } from "react";
import type { ReactElement } from "react";

import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor.js";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper.js";
import vtkPlaneSource from "@kitware/vtk.js/Filters/Sources/PlaneSource.js";
import vtkCalculator from "@kitware/vtk.js/Filters/General/Calculator.js";
import vtkDataSet from "@kitware/vtk.js/Common/DataModel/DataSet.js";
import vtkLookupTable from "@kitware/vtk.js/Common/Core/LookupTable.js";
import vtkWarpScalar from "@kitware/vtk.js/Filters/General/WarpScalar.js";
import { convertActor } from "../vtk2three";
import ThreeView from "../threeView/main";
import VtkView from "../vtkView/main";

function HelloVTK2Three(): ReactElement {
  const vtkContainerRef = useRef<HTMLDivElement>(null);
  const threeContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const lookupTable = vtkLookupTable.newInstance({
      hueRange: [0, 0.667],
    });
    lookupTable.setNumberOfColors(10);

    const { FieldDataTypes } = vtkDataSet;

    const planeSource = vtkPlaneSource.newInstance({
      xResolution: 100,
      yResolution: 100,
    });

    const simpleFilter = vtkCalculator.newInstance();
    simpleFilter.setFormulaSimple(
      FieldDataTypes.POINT,
      [],
      "z",
      (x: number[]) => (x[0] - 0.5) ** 2 + (x[1] - 0.5) ** 2 + 0.125
    );

    const warpScalar = vtkWarpScalar.newInstance();
    const warpMapper = vtkMapper.newInstance({
      interpolateScalarsBeforeMapping: false,
      useLookupTableScalarRange: false,
    });
    // vtk.js 38 d.ts omits lookupTable from IMapperInitialValues
    warpMapper.setLookupTable(lookupTable);

    simpleFilter.setInputConnection(planeSource.getOutputPort());
    warpScalar.setInputConnection(simpleFilter.getOutputPort());
    warpScalar.setInputArrayToProcess(0, "z", "PointData", "Scalars");
    warpMapper.setInputConnection(warpScalar.getOutputPort());

    const warpActor = vtkActor.newInstance();
    warpActor.setMapper(warpMapper);

    // The library now returns a Group with an explicit capability report.
    const converted = convertActor(warpActor);
    const threeContainer = threeContainerRef.current;
    const vtkContainer = vtkContainerRef.current;

    const threeView =
      threeContainer && converted
        ? new ThreeView(threeContainer, converted.object)
        : undefined;
    const vtkView = vtkContainer ? new VtkView(vtkContainer, warpActor) : undefined;

    return () => {
      threeView?.dispose();
      vtkView?.dispose();
      converted?.dispose();
    };
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
