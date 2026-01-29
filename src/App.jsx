import { BrowserRouter, Routes, Route } from "react-router-dom";

import Login from "./pages/login";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import CreateClient from "./pages/CreateClient";
import ClientDetails from "./pages/ClientDetails";

import DashboardLayout from "./components/DashboardLayout";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* LOGIN SEM SIDEBAR */}
        <Route path="/" element={<Login />} />

        {/* ROTAS COM SIDEBAR */}
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/new" element={<CreateClient />} />
          <Route path="/clients/:id" element={<ClientDetails />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
