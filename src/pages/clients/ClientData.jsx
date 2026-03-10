import { useOutletContext } from "react-router-dom";

function formatCurrency(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return "-";
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!text) return "-";

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  return text;
}

function formatBool(value) {
  return value ? "Sim" : "Nao";
}

export default function ClientData() {
  const { client } = useOutletContext() || {};

  if (!client) {
    return <p className="clientSectionText">Cliente nao encontrado.</p>;
  }

  const fields = [
    ["Nome", client.nome],
    ["CPF", client.cpf],
    ["Vendedor", client.vendedor_nome],
    ["Data de nascimento", formatDate(client.data_nascimento)],
    ["Especie", client.especie],
    ["UF do beneficio", client.uf_beneficio],
    ["Numero do beneficio", client.numero_beneficio],
    ["Salario", formatCurrency(client.salario)],
    ["Nome da mae", client.nome_mae],
    ["Telefone", client.telefone],
    ["E-mail", client.email || "-"],
    ["Analfabeto", formatBool(client.analfabeto)],
    ["RG", client.rg_numero],
    ["Orgao expedidor", client.rg_orgao_exp],
    ["UF do RG", client.rg_uf],
    ["Data emissao RG", formatDate(client.rg_data_emissao)],
    ["Naturalidade", client.naturalidade],
    ["CEP", client.cep],
    ["Rua", client.rua],
    ["Numero", client.numero],
    ["Bairro", client.bairro],
  ];

  return (
    <div className="clientSection">
      <h2>Dados do cliente</h2>
      <p className="clientSectionText">Visualizacao completa dos dados cadastrados.</p>

      <div className="clientDataGrid">
        {fields.map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{String(value || "-")}</strong>
          </article>
        ))}
      </div>
    </div>
  );
}
