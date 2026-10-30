# Vérifier ce que sert tafac.fr

Chaque version publiée prouve d’où viennent ses fichiers : le code de la page (JavaScript, CSS, service worker, images) que sert tafac.fr est celui que GitHub Actions a compilé depuis ce dépôt, sans modification.

## Ce qui est publié

À chaque release, le CI (`.github/workflows/ci.yml`, job `docker-publish`) :

- signe la provenance de l’image Docker (`ghcr.io/l-ent-univ/l-ent`) ;
- sort de l’image le frontend qu’elle sert, sur amd64 et arm64, et vérifie qu’ils sont identiques octet par octet ;
- signe la provenance de chacun de ces fichiers ([Sigstore](https://www.sigstore.dev/), via `actions/attest-build-provenance`) : une déclaration signée, enregistrée dans un journal public, liste l’empreinte SHA-256 de chaque fichier, le commit et le workflow qui l’ont produit ;
- joint à la release la liste des fichiers (`dist-manifest.sha256`) et le modèle de la page (`index.template.html`).

## Vérifier un fichier

Avec la [CLI GitHub](https://cli.github.com/) :

```sh
curl -sO https://tafac.fr/sw.js
gh attestation verify sw.js --repo l-ent-univ/tafac
```

La commande vérifie la signature et indique le commit et le workflow d’origine. Un fichier modifié n’a pas d’attestation.

## Vérifier tout le site

```sh
node scripts/verify-deployment.mjs
```

Le script trouve la version que sert le site, vérifie la signature avec `gh`, télécharge chaque fichier du build depuis tafac.fr et le compare à la déclaration signée. Il compare aussi la page elle-même au modèle du build : le serveur n’y remplit que des textes (titre, description, adresse du site), qui ne peuvent pas contenir de balise. `--site` vérifie une autre instance, `--version` une version précise. Sans `gh`, la comparaison se fait avec le manifest de la release, sans vérifier sa signature.

Le build est reproductible : `npm ci && npm run build` sur le commit d’une version donne les mêmes fichiers, sans passer par les attestations.

## Ce que ça ne prouve pas

- **Le code du serveur.** Ce qui s’exécute sur le serveur ne se voit pas de l’extérieur. Les identifiants, les notes et les mails passent par lui (voir « Sessions et données » dans le README).
- **Ce que reçoit une autre personne.** Le script vérifie ce que le site lui envoie, à lui. Un serveur malveillant pourrait servir un autre code à un seul compte. Seule une vérification à chaque chargement, par une extension du navigateur, l’empêcherait.
- **L’intermédiaire réseau.** tafac.fr passe par Cloudflare, qui termine la connexion HTTPS : il voit le trafic en clair et pourrait le modifier.
- **Les versions précédentes.** Seules les releases publiées après l’ajout de ce mécanisme ont des attestations.
