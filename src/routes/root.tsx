import type { ReactElement } from "react";
import { useRoutes } from "react-router-dom";
import type { RouteObject } from "react-router-dom";
import ErrorPage from "../views/ErrorPage";
import HelloVTK2Three from "../views/HelloVTK2Three";

export const routers: RouteObject[] = [
  {
    path: "/hellovtk2three",
    element: <HelloVTK2Three />,
  },
  {
    path: "*",
    element: <ErrorPage />,
  },
];

const Router = (): ReactElement | null => useRoutes(routers);

export default Router;
