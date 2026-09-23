const DEFAULT_LEGAL_CONTENT = `## Éditeur de l’application

**Organisme :** OGEC Beaupeyrat\
**Adresse :** 9 ter rue Petiniaud-Beaupeyrat\
**Contact :** À compléter par l’administrateur de l’établissement\
**SIRET :** À compléter par l’administrateur de l’établissement

Les coordonnées manquantes doivent être renseignées avant la mise en production publique.

## Données traitées

Pour traiter un ticket ou une réservation, l’application peut enregistrer votre nom, votre adresse email, vos coordonnées, le détail de votre demande, les dates de réservation et les pièces jointes transmises.

Ces données sont utilisées uniquement pour traiter la demande, vous répondre, assurer le suivi du dossier et organiser la mise à disposition du matériel. Elles ne sont pas cédées à des fins commerciales.

## Publication et hébergement

**Directeur de publication :** À compléter par l’établissement\
**Hébergeur :** À compléter par l’administrateur technique

## Durée de conservation et droits

Les données sont conservées pendant la durée nécessaire au traitement et à l’archivage des tickets et réservations, conformément aux obligations applicables de l’établissement. Vous pouvez demander l’accès, la rectification, l’effacement ou la limitation du traitement auprès de l’organisme éditeur.

Pour exercer vos droits, utilisez le contact de l’établissement indiqué ci-dessus. Vous pouvez également adresser une réclamation à la CNIL.

## Tickets et réservations

La transmission d’un ticket ou d’une demande de réservation vaut acceptation du traitement des informations nécessaires à cette demande. Les liens de suivi et de connexion reçus par email sont personnels : ne les partagez pas.
`;

function getLegalContent(settings) {
  return typeof settings?.legalContent === 'string' ? settings.legalContent : DEFAULT_LEGAL_CONTENT;
}

module.exports = { DEFAULT_LEGAL_CONTENT, getLegalContent };
