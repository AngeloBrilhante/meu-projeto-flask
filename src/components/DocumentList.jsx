import { useEffect, useState } from "react";
import { listClientDocuments, downloadDocument } from "../services/api";

export default function DocumentList({ clientId }) {
  const [documents, setDocuments] = useState([]);

  useEffect(() => {
    listClientDocuments(clientId).then(data => {
      setDocuments(data.documents || []);
    });
  }, [clientId]);

  return (
    <div>
      <h3>Documentos do Cliente</h3>

      {documents.length === 0 && <p>Nenhum documento enviado.</p>}

      <ul>
        {documents.map((doc, index) => (
          <li key={index}>
            <strong>{doc.type}</strong> — {doc.filename}
            <button
              style={{ marginLeft: "10px" }}
              onClick={() =>
                downloadDocument(clientId, doc.filename)
              }
            >
              Baixar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
