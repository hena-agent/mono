import type { ReactElement } from "react";

export function Overview(): ReactElement {
  return (
    <section className="overview">
      <p className="eyebrow">01 / FOUNDATION</p>
      <h1>A small beginning.</h1>
      <p className="lede">
        An agent that grows with you.
        <br />A small core. Everything else, an extension.
      </p>
      <div className="foundation-grid">
        <div>
          <span className="item-number">01</span>
          <h2>Your machine.</h2>
          <p>A local server, a browser, and nothing to configure.</p>
        </div>
        <div>
          <span className="item-number">02</span>
          <h2>Your building blocks.</h2>
          <p>Tools, models, and capabilities you can make your own.</p>
        </div>
        <div>
          <span className="item-number">03</span>
          <h2>One step at a time.</h2>
          <p>The connection is ready. Conversations arrive in PR1.</p>
        </div>
      </div>
    </section>
  );
}

export function System(): ReactElement {
  return (
    <section className="system-page">
      <p className="eyebrow">02 / SYSTEM</p>
      <h1>System status</h1>
      <p className="lede">The smallest path from your browser to the server.</p>
      <dl className="system-details">
        <div>
          <dt>Transport</dt>
          <dd>Effect RPC / WebSocket</dd>
        </div>
        <div>
          <dt>Endpoint</dt>
          <dd>
            <code>/rpc</code>
          </dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>TanStack Query + DB</dd>
        </div>
        <div>
          <dt>Storage</dt>
          <dd>Not installed yet</dd>
        </div>
      </dl>
    </section>
  );
}

export function NotFound(): ReactElement {
  return (
    <section className="system-page">
      <p className="eyebrow">404 / NOT FOUND</p>
      <h1>This page is not here.</h1>
      <p>Use Overview to return home.</p>
    </section>
  );
}
