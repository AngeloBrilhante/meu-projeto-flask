import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getApiUrl } from "../config/api";
import {
  formatOperationFichaValue,
  getOperationSchema,
  parseOperationFicha,
} from "../constants/operationSchemas";
import { getOperationDossier } from "../services/api";
import "./OperationDossier.css";

const API_URL = getApiUrl();

function formatStatus(status) {
  return String(status || "PENDENTE").replaceAll("_", " ");
}

export default function OperationDossier() {
  const { operationId } = useParams();
  const navigate = useNavigate();

  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const operation = payload?.operation || null;
  const documents = Array.isArray(payload?.documents) ? payload.documents : [];
  const schema = getOperationSchema(operation?.produto);
  const ficha = parseOperationFicha(operation?.ficha_portabilidade);

  const fallbackFichaEntries = useMemo(() => {
    if (schema) return [];

    return Object.entries(ficha).filter(([, value]) => {
      return String(value ?? "").trim() !== "";
    });
  }, [ficha, schema]);

  useEffect(() => {
    let cancelled = false;

    async function loadDossier() {
      try {
        setLoading(true);
        setError("");
        const data = await getOperationDossier(operationId);
        if (!cancelled) {
          setPayload(data);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message || "Não foi possível carregar a ficha.");
          setPayload(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (operationId) {
      loadDossier();
    }

    return () => {
      cancelled = true;
    };
  }, [operationId]);

  return (
    <div className="operationDossierPage">
      <header className="operationDossierHeader">
        <div>
          <h2>Ficha da operação #{operationId}</h2>
          {operation && (
            <p>
              Produto {operation.produto || "-"} | Status {formatStatus(operation.status)}
            </p>
          )}
        </div>

        <button
          type="button"
          className="operationDossierBackButton"
          onClick={() => navigate(-1)}
        >
          Voltar
        </button>
      </header>

      {loading && <p className="operationDossierMessage">Carregando ficha...</p>}
      {!loading && error && <p className="operationDossierError">{error}</p>}

      {!loading && !error && operation && (
        <section className="operationDossierCard">
          {schema ? (
            <div className="operationDossierFicha">
              {schema.groups.map((group) => (
                <div key={group.title} className="operationDossierGroup">
                  <h3>{group.title}</h3>
                  <div className="operationDossierGrid">
                    {group.fields.map((field) => (
                      <article key={field.name}>
                        <span>{field.label}</span>
                        <strong>
                          {formatOperationFichaValue(ficha[field.name], field.type)}
                        </strong>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : fallbackFichaEntries.length > 0 ? (
            <div className="operationDossierGroup">
              <h3>Dados da ficha</h3>
              <div className="operationDossierGrid">
                {fallbackFichaEntries.map(([name, value]) => (
                  <article key={name}>
                    <span>{name}</span>
                    <strong>{String(value)}</strong>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <p className="operationDossierMessage">
              Esta operação não possui ficha preenchida.
            </p>
          )}
        </section>
      )}

      {!loading && !error && operation && (
        <section className="operationDossierCard">
          <h3>Documentos enviados</h3>

          {documents.length === 0 ? (
            <p className="operationDossierMessage">Nenhum documento enviado.</p>
          ) : (
            <ul className="operationDossierDocsList">
              {documents.map((doc) => (
                <li key={doc.filename} className="operationDossierDocItem">
                  <div>
                    <strong>{doc.type || "ARQUIVO"}</strong>
                    <span>{doc.filename || "-"}</span>
                    <small>{doc.uploaded_at || "-"}</small>
                  </div>

                  <a
                    className="operationDossierLink"
                    href={`${API_URL}/clients/${operation.cliente_id}/documents/${encodeURIComponent(
                      doc.filename
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
