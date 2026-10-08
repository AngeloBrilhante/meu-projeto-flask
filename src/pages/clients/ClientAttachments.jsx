import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Download,
  Eye,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  MessageCircle,
  Pencil,
  Search,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  deleteClientAttachment,
  downloadClientAttachment,
  fetchClientAttachmentBlob,
  listClientAttachments,
  updateClientAttachment,
  uploadClientAttachment,
} from "../../services/api";
import "./ClientAttachments.css";

const CATEGORIES = [
  { value: "CONVERSA_WHATSAPP", label: "Conversa WhatsApp" },
  { value: "PRINT", label: "Print" },
  { value: "AUDIO", label: "Audio" },
  { value: "DOCUMENTO", label: "Documento" },
  { value: "COMPROVANTE", label: "Comprovante" },
  { value: "CONTRATO", label: "Contrato" },
  { value: "OUTROS", label: "Outros" },
];

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((item) => [item.value, item.label]));

const IMAGE_EXT = ["jpg", "jpeg", "png", "webp"];
const AUDIO_EXT = ["opus", "ogg", "mp3", "m4a", "wav"];
const SHEET_EXT = ["xls", "xlsx"];
const DOC_EXT = ["doc", "docx"];
const ALLOWED_EXT = [
  "pdf",
  ...IMAGE_EXT,
  "heic",
  ...AUDIO_EXT,
  "txt",
  "zip",
  ...DOC_EXT,
  ...SHEET_EXT,
];
const MAX_BYTES = 25 * 1024 * 1024;

function getExtension(name) {
  const text = String(name || "");
  return text.includes(".") ? text.split(".").pop().toLowerCase() : "";
}

function suggestCategory(ext) {
  if (AUDIO_EXT.includes(ext)) return "AUDIO";
  if (ext === "txt" || ext === "zip") return "CONVERSA_WHATSAPP";
  if (IMAGE_EXT.includes(ext) || ext === "heic") return "PRINT";
  return "DOCUMENTO";
}

function previewKind(ext) {
  if (IMAGE_EXT.includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (ext === "txt") return "chat";
  return null;
}

function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FileTypeIcon({ ext, size = 22 }) {
  if (IMAGE_EXT.includes(ext) || ext === "heic") return <FileImage size={size} />;
  if (AUDIO_EXT.includes(ext)) return <FileAudio size={size} />;
  if (ext === "txt") return <MessageCircle size={size} />;
  if (ext === "zip") return <FileArchive size={size} />;
  if (SHEET_EXT.includes(ext)) return <FileSpreadsheet size={size} />;
  if (ext === "pdf" || DOC_EXT.includes(ext)) return <FileText size={size} />;
  return <File size={size} />;
}

// Conversas exportadas do WhatsApp:
// Android: "12/03/2024 14:35 - Maria: texto"
// iPhone:  "[12/03/2024, 14:35:22] Maria: texto"
const ANDROID_LINE = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),? (\d{1,2}:\d{2})(?::\d{2})? - (.*)$/;
const IOS_LINE = /^‎?\[(\d{1,2}\/\d{1,2}\/\d{2,4}),? (\d{1,2}:\d{2})(?::\d{2})?\] (.*)$/;

function parseWhatsAppChat(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const messages = [];
  let recognized = 0;

  lines.forEach((rawLine) => {
    const line = rawLine.replace(/^‎/, "");
    const match = line.match(ANDROID_LINE) || line.match(IOS_LINE);

    if (match) {
      recognized += 1;
      const [, date, time, rest] = match;
      const separator = rest.indexOf(": ");
      if (separator > 0) {
        messages.push({
          date,
          time,
          author: rest.slice(0, separator),
          text: rest.slice(separator + 2),
        });
      } else {
        messages.push({ date, time, author: null, text: rest });
      }
      return;
    }

    if (messages.length > 0) {
      messages[messages.length - 1].text += `\n${line}`;
    }
  });

  if (recognized < 2) return null;
  return messages;
}

function WhatsAppChatView({ text }) {
  const messages = useMemo(() => parseWhatsAppChat(text), [text]);

  if (!messages) {
    return <pre className="attachmentPlainText">{text}</pre>;
  }

  const authors = [...new Set(messages.filter((m) => m.author).map((m) => m.author))];
  const mainAuthor = authors[0];
  let lastDate = null;

  return (
    <div className="chatView">
      {messages.map((message, index) => {
        const showDate = message.date !== lastDate;
        lastDate = message.date;

        return (
          <div key={index} className="chatRow">
            {showDate && <div className="chatDate">{message.date}</div>}
            {message.author ? (
              <div
                className={
                  message.author === mainAuthor ? "chatBubble outgoing" : "chatBubble"
                }
              >
                <strong>{message.author}</strong>
                <p>{message.text}</p>
                <span>{message.time}</span>
              </div>
            ) : (
              <div className="chatSystem">{message.text}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AttachmentThumb({ clientId, attachment }) {
  const [url, setUrl] = useState(null);
  const isImage = IMAGE_EXT.includes(attachment.extension);

  useEffect(() => {
    if (!isImage) return undefined;
    let objectUrl = null;
    let cancelled = false;

    fetchClientAttachmentBlob(clientId, attachment.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [clientId, attachment.id, isImage]);

  if (isImage && url) {
    return <img src={url} alt={attachment.original_name} className="attachmentThumbImage" />;
  }

  return (
    <div className={`attachmentThumbIcon type-${previewKind(attachment.extension) || "file"}`}>
      <FileTypeIcon ext={attachment.extension} size={34} />
      <span>{attachment.extension.toUpperCase() || "ARQ"}</span>
    </div>
  );
}

function AttachmentViewer({ clientId, items, index, onClose, onNavigate, onDownload }) {
  const attachment = items[index];
  const kind = previewKind(attachment.extension);
  const [state, setState] = useState({ loading: true, url: null, text: "", error: "" });

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    setState({ loading: true, url: null, text: "", error: "" });

    fetchClientAttachmentBlob(clientId, attachment.id)
      .then(async (blob) => {
        if (cancelled) return;
        if (kind === "chat") {
          const text = await blob.text();
          if (!cancelled) setState({ loading: false, url: null, text, error: "" });
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setState({ loading: false, url: objectUrl, text: "", error: "" });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ loading: false, url: null, text: "", error: error.message });
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [clientId, attachment.id, kind]);

  useEffect(() => {
    function handleKey(event) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && index < items.length - 1) onNavigate(index + 1);
      if (event.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [index, items.length, onClose, onNavigate]);

  return (
    <div className="attachmentViewerBackdrop" onClick={onClose} role="presentation">
      <div
        className="attachmentViewer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={attachment.original_name}
      >
        <header>
          <div>
            <strong>{attachment.original_name}</strong>
            <span>
              {CATEGORY_LABELS[attachment.category] || attachment.category} ·{" "}
              {formatSize(attachment.size)} · {formatDate(attachment.uploaded_at)}
            </span>
          </div>
          <div className="attachmentViewerActions">
            <button type="button" className="iconButton" onClick={() => onDownload(attachment)} title="Baixar">
              <Download size={18} />
            </button>
            <button type="button" className="iconButton" onClick={onClose} title="Fechar">
              <X size={18} />
            </button>
          </div>
        </header>

        {attachment.description && (
          <p className="attachmentViewerDescription">{attachment.description}</p>
        )}

        <div className={`attachmentViewerBody kind-${kind}`}>
          {state.loading && (
            <div className="attachmentViewerStatus">
              <Loader2 className="spin" size={26} /> Carregando...
            </div>
          )}
          {state.error && <div className="attachmentViewerStatus">{state.error}</div>}
          {!state.loading && !state.error && kind === "image" && (
            <img src={state.url} alt={attachment.original_name} />
          )}
          {!state.loading && !state.error && kind === "pdf" && (
            <iframe src={state.url} title={attachment.original_name} />
          )}
          {!state.loading && !state.error && kind === "audio" && (
            <div className="attachmentAudio">
              <FileAudio size={48} />
              <audio src={state.url} controls autoPlay />
            </div>
          )}
          {!state.loading && !state.error && kind === "chat" && (
            <WhatsAppChatView text={state.text} />
          )}
        </div>

        {items.length > 1 && (
          <footer>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={index === 0}
              onClick={() => onNavigate(index - 1)}
            >
              <ChevronLeft size={16} /> Anterior
            </button>
            <span>
              {index + 1} de {items.length}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={index === items.length - 1}
              onClick={() => onNavigate(index + 1)}
            >
              Proximo <ChevronRight size={16} />
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

export default function ClientAttachments() {
  const { id } = useParams();
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [viewerIndex, setViewerIndex] = useState(null);
  const [editing, setEditing] = useState(null);
  const fileInputRef = useRef(null);

  const loadAttachments = useCallback(async () => {
    try {
      setError("");
      const data = await listClientAttachments(id);
      setAttachments(data.attachments || []);
    } catch (err) {
      setError(err.message || "Nao foi possivel carregar os anexos.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    loadAttachments();
  }, [loadAttachments]);

  const addFiles = useCallback((fileList) => {
    const items = Array.from(fileList || []).map((file) => {
      const ext = getExtension(file.name);
      let problem = "";
      if (!ALLOWED_EXT.includes(ext)) problem = "Tipo de arquivo nao permitido";
      else if (file.size > MAX_BYTES) problem = "Maior que 25 MB";

      return {
        key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        ext,
        categoria: suggestCategory(ext),
        descricao: "",
        progress: 0,
        status: problem ? "error" : "pending",
        message: problem,
      };
    });
    setQueue((prev) => [...prev, ...items]);
  }, []);

  useEffect(() => {
    function handlePaste(event) {
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length === 0) return;
      event.preventDefault();

      const stamp = new Date()
        .toISOString()
        .replace(/[-:T]/g, "")
        .slice(0, 14);
      const named = files.map((file, index) => {
        if (file.name && file.name !== "image.png") return file;
        const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
        return new window.File([file], `print-${stamp}-${index + 1}.${ext}`, {
          type: file.type,
        });
      });
      addFiles(named);
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [addFiles]);

  function updateQueueItem(key, patch) {
    setQueue((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  async function handleUploadAll() {
    const pending = queue.filter((item) => item.status === "pending");
    if (pending.length === 0) return;

    setUploading(true);
    for (const item of pending) {
      updateQueueItem(item.key, { status: "uploading", progress: 0 });
      try {
        await uploadClientAttachment(
          id,
          item.file,
          { categoria: item.categoria, descricao: item.descricao },
          (progress) => updateQueueItem(item.key, { progress })
        );
        updateQueueItem(item.key, { status: "done", progress: 100 });
      } catch (err) {
        updateQueueItem(item.key, { status: "error", message: err.message });
      }
    }
    setUploading(false);
    setQueue((prev) => prev.filter((item) => item.status !== "done"));
    loadAttachments();
  }

  async function handleDelete(attachment) {
    if (!window.confirm(`Excluir "${attachment.original_name}"? Ele ira para a lixeira.`)) return;
    try {
      await deleteClientAttachment(id, attachment.id);
      setAttachments((prev) => prev.filter((item) => item.id !== attachment.id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDownload(attachment) {
    try {
      await downloadClientAttachment(id, attachment);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveEdit(event) {
    event.preventDefault();
    try {
      const data = await updateClientAttachment(id, editing.id, {
        categoria: editing.category,
        descricao: editing.description,
      });
      setAttachments((prev) =>
        prev.map((item) => (item.id === editing.id ? data.attachment : item))
      );
      setEditing(null);
    } catch (err) {
      setError(err.message);
    }
  }

  const counts = useMemo(() => {
    const result = { ALL: attachments.length };
    attachments.forEach((item) => {
      result[item.category] = (result[item.category] || 0) + 1;
    });
    return result;
  }, [attachments]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return attachments.filter((item) => {
      if (filter !== "ALL" && item.category !== filter) return false;
      if (!term) return true;
      return (
        item.original_name.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term)
      );
    });
  }, [attachments, filter, search]);

  const previewable = useMemo(
    () => visible.filter((item) => previewKind(item.extension)),
    [visible]
  );

  function openViewer(attachment) {
    const index = previewable.findIndex((item) => item.id === attachment.id);
    if (index >= 0) setViewerIndex(index);
  }

  const pendingCount = queue.filter((item) => item.status === "pending").length;

  return (
    <div className="clientSection attachmentsSection">
      <div className="clientSectionHeader">
        <div>
          <h2>Conversas e anexos</h2>
          <p className="clientSectionText">
            Guarde prints, conversas exportadas do WhatsApp, audios e arquivos do cliente.
            Tudo fica salvo no Aureon, mesmo se o numero for perdido.
          </p>
        </div>
      </div>

      {error && <p className="clientFeedbackError">{error}</p>}

      <div
        className={dragging ? "attachmentDropzone dragging" : "attachmentDropzone"}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <UploadCloud size={34} />
        <div>
          <strong>Arraste arquivos aqui</strong>
          <p>
            ou <button type="button" className="linkInline" onClick={() => fileInputRef.current?.click()}>selecione no computador</button>.
            {" "}
            <span className="attachmentPasteHint">
              <ClipboardPaste size={14} /> Prints podem ser colados com Ctrl+V.
            </span>
          </p>
          <small>PDF, imagens, conversas (.txt/.zip), audios, Word e Excel · ate 25 MB por arquivo</small>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept={ALLOWED_EXT.map((ext) => `.${ext}`).join(",")}
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {queue.length > 0 && (
        <div className="attachmentQueue">
          {queue.map((item) => (
            <div key={item.key} className={`attachmentQueueItem status-${item.status}`}>
              <div className="attachmentQueueIcon">
                <FileTypeIcon ext={item.ext} size={20} />
              </div>
              <div className="attachmentQueueInfo">
                <strong>{item.file.name}</strong>
                <span>
                  {formatSize(item.file.size)}
                  {item.message ? ` · ${item.message}` : ""}
                </span>
                {item.status === "uploading" && (
                  <div className="attachmentProgress">
                    <div style={{ width: `${item.progress}%` }} />
                  </div>
                )}
              </div>
              <select
                className="input"
                value={item.categoria}
                disabled={item.status !== "pending"}
                onChange={(event) => updateQueueItem(item.key, { categoria: event.target.value })}
              >
                {CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
              <input
                className="input"
                placeholder="Descricao (opcional)"
                value={item.descricao}
                maxLength={500}
                disabled={item.status !== "pending"}
                onChange={(event) => updateQueueItem(item.key, { descricao: event.target.value })}
              />
              <button
                type="button"
                className="iconButton"
                title="Remover da lista"
                disabled={item.status === "uploading"}
                onClick={() => setQueue((prev) => prev.filter((q) => q.key !== item.key))}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <div className="attachmentQueueActions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={uploading}
              onClick={() => setQueue([])}
            >
              Limpar lista
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={uploading || pendingCount === 0}
              onClick={handleUploadAll}
            >
              {uploading ? <Loader2 className="spin" size={16} /> : <UploadCloud size={16} />}
              {uploading ? "Enviando..." : `Enviar ${pendingCount} arquivo(s)`}
            </button>
          </div>
        </div>
      )}

      <div className="attachmentToolbar">
        <div className="attachmentFilters">
          <button
            type="button"
            className={filter === "ALL" ? "chip active" : "chip"}
            onClick={() => setFilter("ALL")}
          >
            Todos <span>{counts.ALL || 0}</span>
          </button>
          {CATEGORIES.filter((category) => counts[category.value]).map((category) => (
            <button
              key={category.value}
              type="button"
              className={filter === category.value ? "chip active" : "chip"}
              onClick={() => setFilter(category.value)}
            >
              {category.label} <span>{counts[category.value]}</span>
            </button>
          ))}
        </div>
        <label className="searchField">
          <Search size={16} />
          <input
            placeholder="Buscar por nome ou descricao"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {loading ? (
        <div className="attachmentEmpty">
          <Loader2 className="spin" size={22} /> Carregando anexos...
        </div>
      ) : visible.length === 0 ? (
        <div className="attachmentEmpty">
          <MessageCircle size={30} />
          <strong>
            {attachments.length === 0 ? "Nenhum anexo ainda" : "Nenhum anexo encontrado"}
          </strong>
          <span>
            {attachments.length === 0
              ? "Envie prints e conversas para manter o historico do cliente seguro."
              : "Ajuste o filtro ou a busca."}
          </span>
        </div>
      ) : (
        <div className="attachmentGrid">
          {visible.map((attachment) => {
            const canPreview = Boolean(previewKind(attachment.extension));
            return (
              <article key={attachment.id} className="attachmentCard">
                <button
                  type="button"
                  className="attachmentThumb"
                  onClick={() => (canPreview ? openViewer(attachment) : handleDownload(attachment))}
                  title={canPreview ? "Visualizar" : "Baixar"}
                >
                  <AttachmentThumb clientId={id} attachment={attachment} />
                </button>
                <div className="attachmentCardBody">
                  <span className={`attachmentBadge cat-${attachment.category}`}>
                    {CATEGORY_LABELS[attachment.category] || attachment.category}
                  </span>
                  <strong title={attachment.original_name}>{attachment.original_name}</strong>
                  {attachment.description && <p>{attachment.description}</p>}
                  <small>
                    {formatSize(attachment.size)} · {formatDate(attachment.uploaded_at)}
                    {attachment.uploaded_by_name ? ` · ${attachment.uploaded_by_name}` : ""}
                  </small>
                </div>
                <div className="attachmentCardActions">
                  {canPreview && (
                    <button type="button" className="iconButton" title="Visualizar" onClick={() => openViewer(attachment)}>
                      <Eye size={16} />
                    </button>
                  )}
                  <button type="button" className="iconButton" title="Baixar" onClick={() => handleDownload(attachment)}>
                    <Download size={16} />
                  </button>
                  <button type="button" className="iconButton" title="Editar" onClick={() => setEditing({ ...attachment })}>
                    <Pencil size={16} />
                  </button>
                  <button type="button" className="iconButton danger" title="Excluir" onClick={() => handleDelete(attachment)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {viewerIndex !== null && previewable[viewerIndex] && (
        <AttachmentViewer
          clientId={id}
          items={previewable}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onNavigate={setViewerIndex}
          onDownload={handleDownload}
        />
      )}

      {editing && (
        <div className="attachmentViewerBackdrop" onClick={() => setEditing(null)} role="presentation">
          <form
            className="attachmentEditDialog"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleSaveEdit}
          >
            <h3>Editar anexo</h3>
            <p className="clientSectionText">{editing.original_name}</p>
            <label>
              <span>Categoria</span>
              <select
                className="input"
                value={editing.category}
                onChange={(event) => setEditing((prev) => ({ ...prev, category: event.target.value }))}
              >
                {CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Descricao</span>
              <textarea
                className="input"
                rows={3}
                maxLength={500}
                value={editing.description}
                onChange={(event) => setEditing((prev) => ({ ...prev, description: event.target.value }))}
              />
            </label>
            <div className="attachmentQueueActions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary">
                Salvar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
