import { useRoutes } from "react-router-dom";
import ErrorPage from "../views/ErrorPage";
import HelloVTK from "../views/HelloVTK";

export const routers = [
  {
    path: "/hellovtk",
    name: "HelloVtk",
    element: <HelloVTK />,
  },
  {
    path: "*",
    element: <ErrorPage />,
  },
];

const Router = () => {
  const routes = useRoutes(routers);
  return routes;
};

export default Router;
