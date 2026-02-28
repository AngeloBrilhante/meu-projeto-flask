import { useEffect, useMemo, useState } from "react";
import {
  deleteCurrentUserAvatar,
  getCurrentUserProfile,
  updateCurrentUserPassword,
  updateCurrentUserProfile,
  uploadCurrentUserAvatar,
} from "../services/api";
import "./Profile.css";

function roleLabel(role) {
  const normalized = String(role || "").toUpperCase();
  if (normalized === "ADMIN") return "Administrador";
  if (normalized === "VENDEDOR") return "Vendedor";
  if (normalized === "DIGITADOR_PORT_REFIN") return "Digitador Port/Refin";
  if (normalized === "DIGITADOR_NOVO_CARTAO") return "Digitador Novo/Cartao";
  return normalized || "Usuario";
}

function isBlobUrl(value) {
  return String(value || "").startsWith("blob:");
}

function getInitial(value) {
  return (String(value || "").trim().charAt(0) || "U").toUpperCase();
}

export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);

  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState({
    nome: "",
    email: "",
    telefone: "",
    bio: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    senha_atual: "",
    nova_senha: "",
    confirmacao_nova_senha: "",
  });
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState("");

  const displayName = profile?.nome || "Usuario";
  const displayRole = roleLabel(profile?.role);
  const displayInitial = useMemo(() => getInitial(displayName), [displayName]);

  function persistLocalUser(nextUser) {
    const currentRaw = localStorage.getItem("usuario");
    let current = {};

    if (currentRaw) {
      try {
        current = JSON.parse(currentRaw) || {};
      } catch {
        current = {};
      }
    }

    const merged = { ...current, ...nextUser };
    localStorage.setItem("usuario", JSON.stringify(merged));
    window.dispatchEvent(new Event("user:updated"));
  }

  function applyProfileState(nextProfile) {
    setProfile(nextProfile);
    setProfileForm({
      nome: nextProfile?.nome || "",
      email: nextProfile?.email || "",
      telefone: nextProfile?.telefone || "",
      bio: nextProfile?.bio || "",
    });

    if (isBlobUrl(avatarPreview)) {
      URL.revokeObjectURL(avatarPreview);
    }
    setAvatarPreview(nextProfile?.foto_url || "");
    setAvatarFile(null);
  }

  async function loadProfile() {
    setLoading(true);
    setError("");

    try {
      const data = await getCurrentUserProfile();
      applyProfileState(data);
      persistLocalUser(data);
    } catch (err) {
      setError(err.message || "Erro ao carregar perfil");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    return () => {
      if (isBlobUrl(avatarPreview)) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  function handleProfileInputChange(event) {
    const { name, value } = event.target;
    setProfileForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function handlePasswordInputChange(event) {
    const { name, value } = event.target;
    setPasswordForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function handleAvatarFileChange(event) {
    const selectedFile = event.target.files?.[0] || null;
    setAvatarFile(selectedFile);

    if (isBlobUrl(avatarPreview)) {
      URL.revokeObjectURL(avatarPreview);
    }

    if (selectedFile) {
      setAvatarPreview(URL.createObjectURL(selectedFile));
    } else {
      setAvatarPreview(profile?.foto_url || "");
    }
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    setSavingProfile(true);
    setError("");
    setMessage("");

    try {
      const updated = await updateCurrentUserProfile(profileForm);
      applyProfileState(updated);
      persistLocalUser(updated);
      setMessage("Perfil atualizado com sucesso.");
    } catch (err) {
      setError(err.message || "Erro ao atualizar perfil");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    setSavingPassword(true);
    setError("");
    setMessage("");

    try {
      await updateCurrentUserPassword(passwordForm);
      setPasswordForm({
        senha_atual: "",
        nova_senha: "",
        confirmacao_nova_senha: "",
      });
      setMessage("Senha atualizada com sucesso.");
    } catch (err) {
      setError(err.message || "Erro ao atualizar senha");
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleAvatarUpload() {
    if (!avatarFile) return;

    setSavingAvatar(true);
    setError("");
    setMessage("");

    try {
      const updated = await uploadCurrentUserAvatar(avatarFile);
      applyProfileState(updated);
      persistLocalUser(updated);
      setMessage("Foto atualizada com sucesso.");
    } catch (err) {
      setError(err.message || "Erro ao atualizar foto");
    } finally {
      setSavingAvatar(false);
    }
  }

  async function handleAvatarRemove() {
    setSavingAvatar(true);
    setError("");
    setMessage("");

    try {
      const updated = await deleteCurrentUserAvatar();
      applyProfileState(updated);
      persistLocalUser(updated);
      setMessage("Foto removida com sucesso.");
    } catch (err) {
      setError(err.message || "Erro ao remover foto");
    } finally {
      setSavingAvatar(false);
    }
  }

  if (loading) {
    return <p className="profileLoading">Carregando perfil...</p>;
  }

  return (
    <div className="profilePage">
      <div className="profileHeader">
        <h1>Meu perfil</h1>
        <p>Atualize seus dados, foto e senha de acesso.</p>
      </div>

      {error && <p className="profileError">{error}</p>}
      {message && <p className="profileMessage">{message}</p>}

      <section className="profileGrid">
        <article className="profileCard">
          <h2>Foto e identificacao</h2>

          <div className="profileIdentity">
            <div className="profileAvatar">
              {avatarPreview ? (
                <img src={avatarPreview} alt={displayName} />
              ) : (
                <span>{displayInitial}</span>
              )}
            </div>

            <div>
              <strong>{displayName}</strong>
              <p>{displayRole}</p>
            </div>
          </div>

          <div className="profileAvatarActions">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleAvatarFileChange}
            />

            <div className="profileActionRow">
              <button
                type="button"
                className="primaryProfileBtn"
                onClick={handleAvatarUpload}
                disabled={!avatarFile || savingAvatar}
              >
                {savingAvatar ? "Enviando..." : "Salvar foto"}
              </button>
              <button
                type="button"
                className="ghostProfileBtn"
                onClick={handleAvatarRemove}
                disabled={savingAvatar || !profile?.foto_url}
              >
                Remover foto
              </button>
            </div>
          </div>
        </article>

        <article className="profileCard">
          <h2>Dados pessoais</h2>

          <form className="profileForm" onSubmit={handleProfileSubmit}>
            <label>
              Nome
              <input
                type="text"
                name="nome"
                value={profileForm.nome}
                onChange={handleProfileInputChange}
                required
              />
            </label>

            <label>
              Email
              <input
                type="email"
                name="email"
                value={profileForm.email}
                onChange={handleProfileInputChange}
                required
              />
            </label>

            <label>
              Telefone
              <input
                type="text"
                name="telefone"
                value={profileForm.telefone}
                onChange={handleProfileInputChange}
                placeholder="(00) 00000-0000"
              />
            </label>

            <label>
              Bio
              <textarea
                name="bio"
                value={profileForm.bio}
                onChange={handleProfileInputChange}
                maxLength={255}
                placeholder="Resumo rapido sobre voce"
              />
            </label>

            <button
              type="submit"
              className="primaryProfileBtn"
              disabled={savingProfile}
            >
              {savingProfile ? "Salvando..." : "Salvar perfil"}
            </button>
          </form>
        </article>

        <article className="profileCard">
          <h2>Alterar senha</h2>

          <form className="profileForm" onSubmit={handlePasswordSubmit}>
            <label>
              Senha atual
              <input
                type="password"
                name="senha_atual"
                value={passwordForm.senha_atual}
                onChange={handlePasswordInputChange}
                required
              />
            </label>

            <label>
              Nova senha
              <input
                type="password"
                name="nova_senha"
                value={passwordForm.nova_senha}
                onChange={handlePasswordInputChange}
                required
              />
            </label>

            <label>
              Confirmar nova senha
              <input
                type="password"
                name="confirmacao_nova_senha"
                value={passwordForm.confirmacao_nova_senha}
                onChange={handlePasswordInputChange}
                required
              />
            </label>

            <button
              type="submit"
              className="primaryProfileBtn"
              disabled={savingPassword}
            >
              {savingPassword ? "Atualizando..." : "Atualizar senha"}
            </button>
          </form>
        </article>
      </section>
    </div>
  );
}
