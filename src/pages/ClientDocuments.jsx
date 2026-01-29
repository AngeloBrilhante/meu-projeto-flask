import { useEffect, useState } from "react";
import {
  listClientDocuments,
  downloadDocument,
  uploadDocuments,
  deleteDocument
} from "../services/api";
import "./ClientDocuments.css";

export default function ClientDocuments({ clientId }) {
  const [documents, setDocuments] = useState([]);
  const [docType, setDocType] = useState("");
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");

  function loadDocuments() {
    listClientDocuments(clientId).then((res) => {
      setDocuments(res.documents || []);
    });
  }

  useEffect(() => {
    if (clientId) {
      loadDocuments();
    }
  }, [clientId]);

  async function handleUpload(e) {
    e.preventDefault();

    if (!docType || !file) {
      setMessage("Selecione o tipo e o arquivo.");
      return;
    }

    await uploadDocuments(clientId, {
      document_type: docType,
      file
    });

    setMessage("Documento enviado com sucesso!");
    setDocType("");
    setFile(null);
    loadDocuments();
  }

  return (
    <div className="documentsPage">
      <h2>Documentos do Cliente</h2>

      {/* UPLOAD */}
      <form onSubmit={handleUpload} className="uploadBox">
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
        >
          <option value="">Tipo do documento</option>
          <option value="rg">RG</option>
          <option value="cpf">CPF</option>
          <option value="comprovante">Comprovante</option>
          <option value="foto">Foto</option>
        </select>

        {/* PREVIEW DO TIPO SELECIONADO */}
        {docType && (
          <span className="docPreview">
            Tipo selecionado: <strong>{docType.toUpperCase()}</strong>
          </span>
        )}

        <input
          type="file"
          onChange={(e) => setFile(e.target.files[0])}
        />

        <button type="submit">Enviar</button>

        {message && <span className="message">{message}</span>}
      </form>

      {/* TABELA DE DOCUMENTOS */}
      <div className="documentsTableContainer">
        <table className="documentsTable">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Arquivo</th>
              <th>Ações</th>
            </tr>
          </thead>

          <tbody>
            {documents.length === 0 ? (
              <tr>
                <td colSpan="3" className="emptyRow">
                  Nenhum documento enviado
                </td>
              </tr>
            ) : (
              documents.map((doc, index) => (
                <tr key={index}>
                  <td>{doc.document_type || "Arquivo"}</td>
                  <td>{doc.filename}</td>
                  <td className="actions">
                    <button
                      type="button"
                      className="btnDownload"
                      onClick={() =>
                        downloadDocument(clientId, doc.filename)
                      }
                    >
                      Baixar
                    </button>

                    <button
                      type="button"
                      className="btnDelete"
                      onClick={() =>
                        deleteDocument(clientId, doc.filename)
                      }
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
