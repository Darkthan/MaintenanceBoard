-- Ajout d'un email de contact distinct de l'email de connexion utilisateur
ALTER TABLE "users" ADD COLUMN "contactEmail" TEXT;
