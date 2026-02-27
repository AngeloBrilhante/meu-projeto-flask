import { useEffect, useState } from "react";
import { Outlet, useNavigate, useParams, useLocation } from "react-router-dom";
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

  function isActive(tab) {
    return location.pathname.includes(tab);
  }

  if (!client) {
    return <p className="clientLoading">Carregando cliente...</p>;
  }

  return (
    <div className="clientLayout">
      <header className="clientHeaderCard">
        <div className="clientIdentity">
          <h1>{client.nome}</h1>
          <p>CPF: {client.cpf || "-"}</p>
        </div>

        <div className="clientInfoGrid">
          <article>
            <span>Telefone</span>
            <strong>{client.telefone || "-"}</strong>
          </article>
          <article>
            <span>Salário</span>
            <strong>{formatCurrency(client.salario)}</strong>
          </article>
          <article>
            <span>Espécie</span>
            <strong>{client.especie || "-"}</strong>
          </article>
          <article className="full">
            <span>Endereço</span>
            <strong>
              {client.rua || "-"}, {client.numero || "-"} - {client.bairro || "-"}
            </strong>
          </article>
        </div>
      </header>

      <div className="clientTabs">
        <button
          type="button"
          className={isActive("documentos") ? "clientTabButton active" : "clientTabButton"}
          onClick={() => navigate("documentos")}
        >
          Documentos
        </button>

        <button
          type="button"
          className={isActive("operacoes") ? "clientTabButton active" : "clientTabButton"}
          onClick={() => navigate("operacoes")}
        >
          Operações
        </button>

        <button
          type="button"
          className={
            isActive("comentarios") ? "clientTabButton active" : "clientTabButton"
          }
          onClick={() => navigate("comentarios")}
        >
          Comentários
        </button>
      </div>

      <section className="clientContentCard">
        <Outlet context={{ client }} />
      </section>
    </div>
  );
}
