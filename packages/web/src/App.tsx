import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import RuleStudio from './pages/RuleStudio';
import MetricsDashboard from './pages/MetricsDashboard';
import CaseExplorer from './pages/CaseExplorer';

const navItems = [
  { to: '/rules', label: 'Rule Studio' },
  { to: '/experiments', label: 'Metrics' },
  { to: '/cases', label: 'Cases' },
];

function App() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card px-6 py-3 flex items-center gap-6">
        <h1 className="text-lg font-bold tracking-tight">RuleForge</h1>
        <nav className="flex gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/rules" replace />} />
          <Route path="/rules" element={<RuleStudio />} />
          <Route path="/experiments" element={<MetricsDashboard />} />
          <Route path="/cases" element={<CaseExplorer />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
