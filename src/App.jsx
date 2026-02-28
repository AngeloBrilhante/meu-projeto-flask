import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import ProtectedRoute from "./routes/ProtectedRoute";
import Login from "./pages/login";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import CreateClient from "./pages/CreateClient";

import ClientLayout from "./pages/clients/ClientLayout";
import ClientDocuments from "./pages/clients/ClientDocuments";
import ClientOperations from "./pages/clients/ClientOperations";
import ClientComments from "./pages/clients/ClientComments";

import DashboardLayout from "./components/DashboardLayout";
import Pipeline from "./pages/Pipeline";
import OperationsReport from "./pages/OperationsReport";
import OperationDossier from "./pages/OperationDossier";
import Profile from "./pages/Profile";


export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* LOGIN SEM SIDEBAR */}
        <Route path="/" element={<Login />} />

        {/* ROTAS COM SIDEBAR */}
        <Route
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/new" element={<CreateClient />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/operations-report" element={<OperationsReport />} />
          <Route path="/operations/:operationId/ficha" element={<OperationDossier />} />


          {/* CLIENTE COM SUB-ROTAS */}
          <Route path="/clients/:id" element={<ClientLayout />}>

            {/* Aba padrão */}
            <Route index element={<ClientDocuments />} />

            <Route path="documentos" element={<ClientDocuments />} />
            <Route path="operacoes" element={<ClientOperations />} />
            <Route path="comentarios" element={<ClientComments />} />
            <Route path="status" element={<Navigate to="../comentarios" replace />} />

          </Route>

        </Route>
      </Routes>
    </BrowserRouter>
  );
}
