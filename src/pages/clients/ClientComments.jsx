import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  createOperationComment,
  getOperationComments,
  listClientOperations,
} from "../../services/api";

function formatStatus(status) {
  return String(status || "PENDENTE").replaceAll("_", " ");
}

function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("pt-BR");
}

function getStoredUserId() {
  try {
    const raw = localStorage.getItem("usuario");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const value = Number(parsed?.id);
    return Number.isNaN(value) ? null : value;
  } catch {
    return null;
  }
}

export default function ClientComments() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();

  const preferredOperationId = Number(searchParams.get("operation_id")) || null;
  const currentUserId = useMemo(() => getStoredUserId(), []);

  const [operations, setOperations] = useState([]);
  const [selectedOperationId, setSelectedOperationId] = useState("");
  const [comments, setComments] = useState([]);
  const [message, setMessage] = useState("");
  const [loadingOperations, setLoadingOperations] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [sending, setSending] = useState(false);

  async function loadOperations() {
    try {
      setLoadingOperations(true);
      const data = await listClientOperations(id);
      const list = Array.isArray(data) ? data : [];
      setOperations(list);

      setSelectedOperationId((prev) => {
        const prevId = Number(prev);
        const hasPrev = list.some((item) => item.id === prevId);
        if (hasPrev) return String(prevId);

        if (
          preferredOperationId &&
          list.some((item) => item.id === preferredOperationId)
        ) {
          return String(preferredOperationId);
        }

        return list[0] ? String(list[0].id) : "";
      });
    } catch (error) {
      console.error("Erro ao carregar operações para comentários:", error);
      setOperations([]);
      setSelectedOperationId("");
    } finally {
      setLoadingOperations(false);
    }
  }

  async function loadComments(operationId, options = {}) {
    const { silent = false } = options;

    if (!operationId) {
      setComments([]);
      return;
    }

    try {
      if (!silent) {
        setLoadingComments(true);
      }

      const data = await getOperationComments(operationId);
      setComments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Erro ao carregar comentários:", error);
      if (!silent) {
        setComments([]);
      }
    } finally {
      if (!silent) {
        setLoadingComments(false);
      }
    }
  }

  useEffect(() => {
    if (id) {
      loadOperations();
    }
  }, [id]);

  useEffect(() => {
    if (!selectedOperationId) {
      setComments([]);
      return undefined;
    }

    loadComments(selectedOperationId);

    const interval = setInterval(() => {
      loadComments(selectedOperationId, { silent: true });
    }, 15000);

    return () => clearInterval(interval);
  }, [selectedOperationId]);

  async function handleSendComment(event) {
    event.preventDefault();

    const operationId = Number(selectedOperationId);
    const payload = message.trim();

    if (!operationId) {
      alert("Selecione uma operação");
      return;
    }

    if (!payload) {
      return;
    }

    try {
      setSending(true);
      await createOperationComment(operationId, payload);
      setMessage("");
      await loadComments(operationId, { silent: true });
    } catch (error) {
      console.error("Erro ao enviar comentário:", error);
      alert(error.message || "Não foi possível enviar o comentário");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="clientSection">
      <h2>Comentários</h2>
      <p className="clientSectionText">
        Conversa entre vendedor e admin sobre a operação.
      </p>

      {loadingOperations ? (
        <p className="clientSectionText">Carregando operações...</p>
      ) : operations.length === 0 ? (
        <p className="clientSectionText">
          Nenhuma operação cadastrada para este cliente.
        </p>
      ) : (
        <>
          <div className="commentsToolbar">
            <label className="commentsOperationPicker">
              <span>Operação</span>
              <select
                value={selectedOperationId}
                onChange={(event) => setSelectedOperationId(event.target.value)}
              >
                {operations.map((operation) => (
                  <option key={operation.id} value={operation.id}>
                    #{operation.id} - {operation.produto || "OPERAÇÃO"} (
                    {formatStatus(operation.status)})
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="clientGhostButton"
              onClick={() => loadComments(selectedOperationId)}
              disabled={!selectedOperationId || loadingComments}
            >
              Atualizar
            </button>
          </div>

          <div className="commentsChatCard">
            {loadingComments ? (
              <p className="clientSectionText">Carregando comentários...</p>
            ) : comments.length === 0 ? (
              <p className="clientSectionText">
                Nenhum comentário para esta operação.
              </p>
            ) : (
              <ul className="commentsList">
                {comments.map((comment) => {
                  const isOwn = Number(comment.author_id) === currentUserId;
                  const role = String(comment.author_role || "").toUpperCase();

                  return (
                    <li
                      key={comment.id}
                      className={isOwn ? "commentItem own" : "commentItem"}
                    >
                      <div className="commentMeta">
                        <strong>{comment.author_name || "Usuário"}</strong>
                        <span>
                          {role ? `${role} - ` : ""}
                          {formatDateTime(comment.created_at)}
                        </span>
                      </div>
                      <p>{comment.message}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <form className="commentsComposer" onSubmit={handleSendComment}>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Escreva um comentário sobre a operação..."
              rows={3}
              maxLength={2000}
              disabled={sending || !selectedOperationId}
            />

            <div className="commentsComposerFooter">
              <span>{message.length}/2000</span>
              <button
                type="submit"
                className="clientPrimaryButton"
                disabled={sending || !selectedOperationId}
              >
                {sending ? "Enviando..." : "Enviar comentário"}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
