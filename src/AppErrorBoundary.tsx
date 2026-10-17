import { Component, type ReactNode } from "react";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="app-recovery" role="alert">
      <h1>The app could not open</h1>
      <p>Reload the app to try again. If it still will not open, refresh its app files.</p>
      <button onClick={() => window.location.reload()}>Reload app</button>
      <a href="/recover.html">Refresh app files</a>
      <p>Refreshing app files keeps your saved workspace and sign-in details.</p>
    </main>;
  }
}
