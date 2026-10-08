import { useEffect, useState } from "react";
import { Outlet, useNavigate, useParams, useLocation } from "react-router-dom";
import {
  BadgeInfo,
  Briefcase,
  FileText,
  Home,
  IdCard,
  Mail,
  MapPin,
  MessagesSquare,
  Phone,
  Wallet,
} from "lucide-react";
import "./ClientLayout.css";
import { getApiUrl } from "../../config/api";

const API_URL = getApiUrl();

function formatCurrency(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return "-";
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export default function ClientLayout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [client, setClient] = useState(null);

  async function loadClient() {
    try {
      const token = localStorage.getItem("token");

      const response = await fetch(`${API_URL}/clients/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();
      setClient(data);
    } catch (error) {
      console.error("Erro ao carregar cliente:", error);
    }
  }

  useEffect(() => {
    loadClient();
  }, [id]);

  const tabs = [
    { path: "dados", label: "Dados", icon: IdCard },
    { path: "documentos", label: "Documentos", icon: FileText },
    { path: "anexos", label: "Conversas e anexos", icon: MessagesSquare },
    { path: "operacoes", label: "Operacoes", icon: Briefcase },
  ];

  const currentTab =
    tabs.find((tab) => location.pathname.split("/").includes(tab.path))?.path ||
    "documentos";

  if (!client) {
    return <p className="clientLoading">Carregando cliente...</p>;
  }

  const initials = String(client.nome || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
  const cityState = [client.cidade, client.estado].filter(Boolean).join(" / ");

  return (
    <div className="clientLayout">
      <header className="clientHeaderCard">
        <div className="clientIdentity">
          <div className="clientAvatar">{initials}</div>
          <div>
            <h1>{client.nome}</h1>
            <p>CPF {client.cpf || "-"}</p>
          </div>
        </div>

        <div className="clientInfoGrid">
          <article>
            <Phone size={16} />
            <div>
              <span>Telefone</span>
              <strong>{client.telefone || "-"}</strong>
            </div>
          </article>
          <article>
            <Mail size={16} />
            <div>
              <span>E-mail</span>
              <strong>{client.email || "-"}</strong>
            </div>
          </article>
          <article>
            <Wallet size={16} />
            <div>
              <span>Salario</span>
              <strong>{formatCurrency(client.salario)}</strong>
            </div>
          </article>
          <article>
            <BadgeInfo size={16} />
            <div>
              <span>Especie</span>
              <strong>{client.especie || "-"}</strong>
            </div>
          </article>
          <article>
            <MapPin size={16} />
            <div>
              <span>Cidade / Estado</span>
              <strong>{cityState || "-"}</strong>
            </div>
          </article>
          <article className="full">
            <Home size={16} />
            <div>
              <span>Endereco</span>
              <strong>
                {client.rua || "-"}, {client.numero || "-"} - {client.bairro || "-"}
              </strong>
            </div>
          </article>
        </div>
      </header>

      <nav className="clientTabs">
        {tabs.map(({ path, label, icon: Icon }) => (
          <button
            key={path}
            type="button"
            className={currentTab === path ? "clientTabButton active" : "clientTabButton"}
            onClick={() => navigate(path)}
          >
            <Icon size={16} strokeWidth={1.9} />
            {label}
          </button>
        ))}
      </nav>

      <section className="clientContentCard">
        <Outlet context={{ client, refreshClient: loadClient }} />
      </section>
    </div>
  );
}
