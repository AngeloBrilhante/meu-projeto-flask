import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createClient } from "../services/api";
import {
  DATE_INPUT_PLACEHOLDER,
  formatDateInputValue,
} from "../utils/date";
import "./CreateClient.css";

const INITIAL_FORM = {
  nome: "",
  cpf: "",
  data_nascimento: "",
  especie: "",
  uf_beneficio: "",
  beneficios: [""],
  salario: "",
  nome_mae: "",
  rg_numero: "",
  rg_orgao_exp: "",
  rg_uf: "",
  rg_data_emissao: "",
  naturalidade: "",
  telefone: "",
  email: "",
  analfabeto: false,
  cep: "",
  rua: "",
  numero: "",
  bairro: "",
  cidade: "",
  estado: "",
};

export default function CreateClient() {
  const navigate = useNavigate();
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState("");
  const lastCepLookupRef = useRef("");
  const cepRequestRef = useRef(0);

  const beneficios = useMemo(() => {
    if (Array.isArray(form.beneficios) && form.beneficios.length > 0) {
      return form.beneficios;
    }
    return [""];
  }, [form.beneficios]);

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
        cidade: data.localidade || prev.cidade,
        estado: data.uf || prev.estado,
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
    const { name, value, type, checked } = event.target;

    if (type === "checkbox") {
      setForm((prev) => ({ ...prev, [name]: checked }));
      return;
    }

    if (name === "data_nascimento" || name === "rg_data_emissao") {
      setForm((prev) => ({
        ...prev,
        [name]: formatDateInputValue(value),
      }));
      return;
    }

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

    if (name === "estado") {
      setForm((prev) => ({ ...prev, estado: String(value || "").toUpperCase() }));
      return;
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleBeneficioChange(index, value) {
    setForm((prev) => {
      const nextBeneficios = [...(prev.beneficios || [""])];
      nextBeneficios[index] = value;
      return {
        ...prev,
        beneficios: nextBeneficios,
      };
    });
  }

  function handleAddBeneficio() {
    setForm((prev) => ({
      ...prev,
      beneficios: [...(prev.beneficios || [""]), ""],
    }));
  }

  function handleRemoveBeneficio(index) {
    setForm((prev) => {
      const nextBeneficios = [...(prev.beneficios || [""])].filter(
        (_, currentIndex) => currentIndex !== index
      );
      return {
        ...prev,
        beneficios: nextBeneficios.length > 0 ? nextBeneficios : [""],
      };
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);

    try {
      const normalizedBeneficios = beneficios
        .map((item) => String(item || "").trim())
        .filter(Boolean);

      await createClient({
        ...form,
        numero_beneficio: normalizedBeneficios[0] || "",
        beneficios: normalizedBeneficios,
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
                type="text"
                name="data_nascimento"
                value={form.data_nascimento}
                onChange={handleChange}
                inputMode="numeric"
                placeholder={DATE_INPUT_PLACEHOLDER}
              />
            </label>

            <label className="createField">
              <span>Especie</span>
              <input
                name="especie"
                value={form.especie}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>UF beneficio</span>
              <input
                name="uf_beneficio"
                maxLength={2}
                value={form.uf_beneficio}
                onChange={handleChange}
              />
            </label>

            <div className="createField">
              <div className="createFieldHeader">
                <span>Numero beneficio</span>
                <button
                  type="button"
                  className="createInlineAddButton"
                  onClick={handleAddBeneficio}
                >
                  +
                </button>
              </div>

              <div className="createBenefitList">
                {beneficios.map((beneficio, index) => (
                  <div key={`beneficio-${index}`} className="createBenefitRow">
                    <input
                      value={beneficio}
                      onChange={(event) =>
                        handleBeneficioChange(index, event.target.value)
                      }
                    />
                    {beneficios.length > 1 && (
                      <button
                        type="button"
                        className="createInlineRemoveButton"
                        onClick={() => handleRemoveBeneficio(index)}
                      >
                        Remover
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <label className="createField">
              <span>Salario</span>
              <input
                name="salario"
                value={form.salario}
                onChange={handleChange}
                inputMode="decimal"
                pattern="[0-9.,\\s-]*"
                placeholder="1.650,50"
              />
            </label>

            <label className="createField span2">
              <span>Nome da mae</span>
              <input
                name="nome_mae"
                value={form.nome_mae}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>RG numero</span>
              <input
                name="rg_numero"
                value={form.rg_numero}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>RG orgao emissor</span>
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
              <span>Data emissao RG</span>
              <input
                type="text"
                name="rg_data_emissao"
                value={form.rg_data_emissao}
                onChange={handleChange}
                inputMode="numeric"
                placeholder={DATE_INPUT_PLACEHOLDER}
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
              <span>E-mail (opcional)</span>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="cliente@email.com"
              />
            </label>

            <div className="createField createCheckboxField">
              <span>Analfabeto (opcional)</span>
              <label className="createCheckboxControl">
                <input
                  type="checkbox"
                  name="analfabeto"
                  checked={Boolean(form.analfabeto)}
                  onChange={handleChange}
                />
                <span>Cliente analfabeto</span>
              </label>
            </div>

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
              <span>Numero</span>
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

            <label className="createField">
              <span>Cidade</span>
              <input
                name="cidade"
                value={form.cidade}
                onChange={handleChange}
              />
            </label>

            <label className="createField">
              <span>Estado</span>
              <input
                name="estado"
                maxLength={2}
                value={form.estado}
                onChange={handleChange}
                placeholder="UF"
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
