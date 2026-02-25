import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createClient } from "../services/api";
import "./CreateClient.css";

const INITIAL_FORM = {
  nome: "",
  cpf: "",
  data_nascimento: "",
  especie: "",
  uf_beneficio: "",
  numero_beneficio: "",
  salario: "",
  nome_mae: "",
  rg_numero: "",
  rg_orgao_exp: "",
  rg_uf: "",
  rg_data_emissao: "",
  naturalidade: "",
  telefone: "",
  cep: "",
  rua: "",
  numero: "",
  bairro: "",
};

export default function CreateClient() {
  const navigate = useNavigate();
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState("");
  const lastCepLookupRef = useRef("");
  const cepRequestRef = useRef(0);

  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function formatCep(value) {
    const digits = onlyDigits(value).slice(0, 8);
    if (digits.length <= 5) {
      return digits;
    }

    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }

  async function lookupAddressByCep(cepDigits) {
    if (cepDigits.length !== 8 || cepDigits === lastCepLookupRef.current) {
      return;
    }

    const requestId = ++cepRequestRef.current;
    setCepLoading(true);
    setCepError("");

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`);
      const data = await response.json();

      if (requestId !== cepRequestRef.current) {
        return;
      }

      if (!response.ok || data.erro) {
        setCepError("CEP nao encontrado.");
        return;
      }

      setForm((prev) => ({
        ...prev,
        rua: data.logradouro || prev.rua,
        bairro: data.bairro || prev.bairro,
      }));
      lastCepLookupRef.current = cepDigits;
    } catch {
      if (requestId !== cepRequestRef.current) {
        return;
      }
      setCepError("Nao foi possivel buscar o endereco.");
    } finally {
      if (requestId === cepRequestRef.current) {
        setCepLoading(false);
      }
    }
  }

  function handleChange(event) {
    const { name, value } = event.target;

    if (name === "cep") {
      const nextCep = formatCep(value);
      const cepDigits = onlyDigits(nextCep);

      setForm((prev) => ({ ...prev, cep: nextCep }));
      setCepError("");

      if (cepDigits.length === 8) {
        lookupAddressByCep(cepDigits);
      } else {
        setCepLoading(false);
        lastCepLookupRef.current = "";
      }

      return;
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);

    try {
      await createClient({
        ...form,
        salario: form.salario ? Number(form.salario) : null,
      });

      alert("Cliente cadastrado com sucesso!");
      navigate("/clients");
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="createClientPage">
      <div className="createClientCard">
        <div className="createClientHeader">
          <h1>Novo cliente</h1>
          <p>Preencha os dados para cadastrar o cliente no fluxo comercial.</p>
        </div>

        <form onSubmit={handleSubmit} className="createClientForm">
          <div className="createClientGrid">
            <label className="createField span2">
              <span>Nome</span>
              <input
                name="nome"
                value={form.nome}
                onChange={handleChange}
                required
              />
            </label>

            <label className="createField">
              <span>CPF</span>
              <input
                name="cpf"
                value={form.cpf}
                onChange={handleChange}
                placeholder="Somente numeros"
                required
              />
            </label>

            <label className="createField">
              <span>Data de nascimento</span>
              <input
                type="date"
                name="data_nascimento"
                value={form.data_nascimento}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>Espécie</span>
              <input
                name="especie"
                value={form.especie}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>UF benefício</span>
              <input
                name="uf_beneficio"
                maxLength={2}
                value={form.uf_beneficio}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>Número benefício</span>
              <input
                name="numero_beneficio"
                value={form.numero_beneficio}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>Salário</span>
              <input
                name="salario"
                value={form.salario}
                onChange={handleChange}
                placeholder="0.00"
              />
            </label>

            <label className="createField span2">
              <span>Nome da mãe</span>
              <input
                name="nome_mae"
                value={form.nome_mae}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>RG número</span>
              <input
                name="rg_numero"
                value={form.rg_numero}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>RG órgão emissor</span>
              <input
                name="rg_orgao_exp"
                value={form.rg_orgao_exp}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>RG UF</span>
              <input
                name="rg_uf"
                maxLength={2}
                value={form.rg_uf}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>Data emissão RG</span>
              <input
                type="date"
                name="rg_data_emissao"
                value={form.rg_data_emissao}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>Naturalidade</span>
              <input
                name="naturalidade"
                value={form.naturalidade}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>Telefone</span>
              <input
                name="telefone"
                value={form.telefone}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>CEP</span>
              <input
                name="cep"
                value={form.cep}
                onChange={handleChange}
                placeholder="00000-000"
              />
              {cepLoading && (
                <small className="createFieldHint">Buscando endereco...</small>
              )}
              {!cepLoading && cepError && (
                <small className="createFieldError">{cepError}</small>
              )}
            </label>

            <label className="createField span2">
              <span>Rua</span>
              <input name="rua" value={form.rua} onChange={handleChange} />
            </label>

            <label className="createField">
              <span>Número</span>
              <input
                name="numero"
                value={form.numero}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>Bairro</span>
              <input
                name="bairro"
                value={form.bairro}
                onChange={handleChange}
              />
            </label>
          </div>

          <div className="createActions">
            <button
              type="button"
              className="createGhostButton"
              onClick={() => navigate("/clients")}
              disabled={saving}
            >
              Cancelar
            </button>

            <button type="submit" className="createPrimaryButton" disabled={saving}>
              {saving ? "Salvando..." : "Salvar cliente"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
