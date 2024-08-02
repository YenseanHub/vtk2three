import { useRoutes } from "react-router-dom";
import ErrorPage from "../views/ErrorPage";
import HelloVTK2Three from "../views/HelloVTK2Three";

export const routers = [
  {
    path: "/hellovtk2three",
    name: "HelloVTK2Three",
    element: <HelloVTK2Three />,
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
