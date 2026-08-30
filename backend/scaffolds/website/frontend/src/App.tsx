import { BrowserRouter, Routes, Route, Link, NavLink } from 'react-router-dom';

import Dashboard from './pages/Dashboard';
import History from './pages/History';
import { deviceSpec } from './lib/deviceSpec';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <aside className="side">
          <div className="brand">{deviceSpec.name}</div>
          <nav>
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
              Dashboard
            </NavLink>
            <NavLink to="/history" className={({ isActive }) => (isActive ? 'active' : '')}>
              History
            </NavLink>
          </nav>
          <div className="side-foot">
            <Link to="/">Live</Link>
          </div>
        </aside>
        <main className="main">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="history" element={<History />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
