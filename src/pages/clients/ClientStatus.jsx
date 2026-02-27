import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getClientStatus, updateClientStatus } from "../../services/api";

export default function ClientStatus() {
  const { id } = useParams();
  const [status, setStatus] = useState("");

  async function loadStatus() {
    try {
      const data = await getClientStatus(id);
      setStatus(data.status || "");
    } catch (error) {
      console.error("Erro ao carregar status:", error);
    }
  }

  async function handleUpdate() {
    try {
      await updateClientStatus(id, status);
      alert("Status atualizado com sucesso");
    } catch (error) {
      console.error("Erro ao atualizar status:", error);
    }
  }

  useEffect(() => {
    loadStatus();
  }, [id]);

  return (
    <div className="clientSection">
      <h2>Status</h2>
      <p className="clientSectionText">Atualização do status comercial do cliente.</p>

      <div className="statusPanel">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Selecione</option>
          <option value="em_analise">Em análise</option>
          <option value="aprovado">Aprovado</option>
          <option value="recusado">Recusado</option>
          <option value="liberado">Liberado</option>
        </select>

        <button type="button" className="clientPrimaryButton" onClick={handleUpdate}>
          Atualizar status
        </button>
      </div>
    </div>
  );
}
