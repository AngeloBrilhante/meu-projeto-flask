import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  deleteDocument,
  downloadDocument,
  listClientDocuments,
  uploadDocuments,
} from "../../services/api";

export default function ClientDocuments() {
  const { id } = useParams();
  const [documents, setDocuments] = useState([]);
  const [files, setFiles] = useState({});
  const [loading, setLoading] = useState(false);

  async function loadDocuments() {
    try {
      const data = await listClientDocuments(id);
      setDocuments(data.documents || []);
    } catch (error) {
      console.error("Erro ao carregar documentos:", error);
    }
  }

  useEffect(() => {
    loadDocuments();
  }, [id]);

  async function handleUpload(event) {
    event.preventDefault();
    setLoading(true);

    try {
      await uploadDocuments(id, files);
      setFiles({});
      loadDocuments();
      alert("Upload realizado com sucesso");
    } catch (error) {
      console.error("Erro no upload:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(filename) {
    if (!window.confirm("Deseja excluir este documento?")) return;

    try {
      await deleteDocument(id, filename);
      loadDocuments();
    } catch (error) {
      console.error("Erro ao excluir:", error);
    }
  }

  async function handleDownload(filename) {
    try {
      await downloadDocument(id, filename);
    } catch (error) {
      alert(error.message || "Nao foi possivel baixar o documento");
    }
  }

  function handleFileChange(event) {
    const { name, files: selectedFiles } = event.target;

    setFiles((prev) => ({
      ...prev,
      [name]: selectedFiles[0],
    }));
  }

  return (
    <div className="clientSection">
      <h2>Documentos</h2>
      <p className="clientSectionText">Envio e gerenciamento de documentos do cliente.</p>

      <form onSubmit={handleUpload} className="documentsUploadForm">
        <h3>Upload de documentos</h3>

        <div className="documentsUploadGrid">
          <label className="documentsField">
            <span>RG</span>
            <input type="file" name="rg" onChange={handleFileChange} />
          </label>

          <label className="documentsField">
            <span>CPF</span>
            <input type="file" name="cpf" onChange={handleFileChange} />
          </label>

          <label className="documentsField">
            <span>Comprovante de residencia</span>
            <input type="file" name="residencia" onChange={handleFileChange} />
          </label>
        </div>

        <div className="documentsSubmit">
          <button type="submit" className="clientPrimaryButton" disabled={loading}>
            {loading ? "Enviando..." : "Enviar documentos"}
          </button>
        </div>
      </form>

      <h3>Documentos enviados</h3>

      {documents.length === 0 ? (
        <p className="clientSectionText">Nenhum documento enviado.</p>
      ) : (
        <div className="documentsList">
          {documents.map((doc) => (
            <article key={doc.filename} className="documentItem">
              <div className="documentInfo">
                <strong>{doc.type}</strong>
                <span>{doc.uploaded_at}</span>
              </div>

              <div className="documentActions">
                <button
                  type="button"
                  className="clientLinkButton"
                  onClick={() => handleDownload(doc.filename)}
                >
                  Baixar
                </button>

                <button
                  type="button"
                  className="clientDangerButton"
                  onClick={() => handleDelete(doc.filename)}
                >
                  Excluir
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
