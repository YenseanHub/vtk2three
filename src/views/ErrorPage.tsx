import type { ReactElement } from "react";

export default function ErrorPage(): ReactElement {
  return (
    <div id="error-page">
      <h1>Oops!</h1>
      <p>Sorry, an unexpected error has occurred.</p>
      <p>404</p>
    </div>
  );
}
