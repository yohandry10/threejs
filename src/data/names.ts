export interface CultureNames {
  male: string[];
  female: string[];
  minorHouses: string[];
  ships: string[];
}

export const CULTURES: Record<string, CultureNames> = {
  west: {
    male: ['Edric', 'Aldous', 'Rowan', 'Garrick', 'Oswin', 'Wystan', 'Leofric', 'Alaric', 'Godwin', 'Aldred', 'Hereward', 'Osric', 'Wilmot', 'Cuthbert', 'Everard', 'Hadric', 'Tobin', 'Edmer'],
    female: ['Aelwyn', 'Maud', 'Isolde', 'Edith', 'Rowena', 'Elswyth', 'Aveline', 'Hilde', 'Wynne', 'Leofa', 'Godiva', 'Aldith', 'Ermina', 'Mildreth', 'Sunniva', 'Ellyn'],
    minorHouses: ['Harrow', 'Wendell', 'Briar', 'Oakes', 'Marlow', 'Thorne', 'Ashby', 'Colbrook', 'Pembry', 'Fallow'],
    ships: ['Harvest Queen', 'Golden Sheaf', 'Westwind', 'Stalwart', 'Sickle Moon', 'Aldhaven Pride', 'Fair Meadow', 'Iron Plough'],
  },
  central: {
    male: ['Amaury', 'Thibault', 'Gaspard', 'Lucien', 'Renaud', 'Aymeric', 'Bastien', 'Florent', 'Olivier', 'Valere', 'Enguerrand', 'Hugues', 'Josselin', 'Mathieu', 'Raoul', 'Tristan'],
    female: ['Aurore', 'Clemence', 'Eloise', 'Isaure', 'Margaux', 'Oriane', 'Sabine', 'Blanche', 'Ysolde', 'Adele', 'Heloise', 'Mahaut', 'Perrine', 'Solene', 'Violaine'],
    minorHouses: ['Cressy', 'Lanreth', 'Duvant', 'Morel', 'Sorrel', 'Vaudry', 'Belcourt', 'Arnaud', 'Pellow', 'Rochefort'],
    ships: ['Sunlance', 'Red Mare', 'Valmont', 'Gilded Spur', 'Crimson Tide', 'Dominion'],
  },
  north: {
    male: ['Gunther', 'Ulric', 'Konrad', 'Brandt', 'Hagen', 'Dietmar', 'Reinhold', 'Otto', 'Falk', 'Anselm', 'Berthold', 'Egon', 'Helmar', 'Lothar', 'Wendel', 'Arnulf'],
    female: ['Gertrud', 'Hedda', 'Ilse', 'Adelheid', 'Sigrun', 'Liesl', 'Walda', 'Ortrun', 'Gisela', 'Irmgard', 'Mechthild', 'Rotrud', 'Swanhild', 'Hilda'],
    minorHouses: ['Frost', 'Kelda', 'Stonebarrow', 'Greyholt', 'Irongate', 'Coldwater', 'Hartmann', 'Rimeholt'],
    ships: ['Grey Warden', 'Stonebreaker', 'Northern Star', 'Frostfang'],
  },
  norse: {
    male: ['Hakon', 'Eirik', 'Sten', 'Torvald', 'Arne', 'Leif', 'Ivar', 'Ragnvald', 'Orm', 'Halvard', 'Bjarni', 'Einar', 'Gorm', 'Kjartan', 'Sigvald', 'Trygve'],
    female: ['Astrid', 'Sigrid', 'Ingrid', 'Ragna', 'Solveig', 'Thyra', 'Gudrun', 'Ylva', 'Freydis', 'Aslaug', 'Bergljot', 'Gunnhild', 'Hallveig', 'Tora'],
    minorHouses: ['Skelde', 'Holmgard', 'Ravensea', 'Tern', 'Brimstad', 'Haldor', 'Vesterholm', 'Kjell'],
    ships: ['Sea Wolf', 'Wave Rider', 'Storm Hound', 'Tidebreaker', 'Grey Gull', 'Norhaven Wrath', 'Salt Jarl', 'Whale Road'],
  },
  south: {
    male: ['Lorenzo', 'Matteo', 'Cosimo', 'Aurelio', 'Silvio', 'Enzo', 'Dario', 'Rinaldo', 'Tommaso', 'Vittore', 'Alessio', 'Benedetto', 'Fabrizio', 'Giacomo', 'Orsino', 'Paolo'],
    female: ['Bianca', 'Chiara', 'Livia', 'Serafina', 'Lucia', 'Ottavia', 'Giada', 'Viola', 'Beatrice', 'Camilla', 'Fiammetta', 'Isotta', 'Marzia', 'Nerina'],
    minorHouses: ['Coralli', 'Ystrani', 'Merrow', 'Calder', 'Seravel', 'Ambrosi', 'Tallone', 'Venturi', 'Brightwater'],
    ships: ['Golden Key', 'Fortuna', 'Lirien Star', 'Serene', 'Silken Wind', 'Merchant Prince', 'Amber Tide', 'Coral Queen'],
  },
  sea: {
    male: ['Mael', 'Yannick', 'Corentin', 'Erwan', 'Tanguy', 'Gwenael', 'Loic', 'Ronan', 'Alan', 'Brieuc', 'Goulven', 'Herve', 'Judikael', 'Riwal'],
    female: ['Morgane', 'Enora', 'Maiwenn', 'Nolwenn', 'Soazig', 'Azenor', 'Rozenn', 'Gaela', 'Anaig', 'Sterenn', 'Katell', 'Tifenn'],
    minorHouses: ['Seawatch', 'Kerlan', 'Penmor', 'Trevarn', 'Guillard', 'Morlaix'],
    ships: ['Silver Anchor', 'Strait Warden', 'Unsleeping', 'Blue Wall', 'Skarholm', 'Watchful'],
  },
  ember: {
    male: ['Borek', 'Radko', 'Dragan', 'Vuk', 'Stanek', 'Milos', 'Zoran', 'Branko', 'Yarin', 'Oleg', 'Bogdan', 'Kazimir', 'Ratimir', 'Velek'],
    female: ['Vesna', 'Mira', 'Dobrava', 'Zora', 'Lada', 'Jarka', 'Milena', 'Rada', 'Dana', 'Svetla', 'Bozena', 'Ljuba', 'Zlata'],
    minorHouses: ['Cinder', 'Ashport', 'Slagmoor', 'Harth', 'Kovac', 'Ruda', 'Emberly'],
    ships: ['Anvil', 'Cinder', 'Forgefire', 'Black Iron', 'Ember'],
  },
  green: {
    male: ['Bran', 'Cadoc', 'Emrys', 'Gwion', 'Rhodri', 'Dafydd', 'Owain', 'Idris', 'Madoc', 'Tudur', 'Cynan', 'Iorwerth', 'Llew', 'Meurig'],
    female: ['Bronwen', 'Carys', 'Eira', 'Gwen', 'Nia', 'Rhian', 'Seren', 'Tegan', 'Elin', 'Ffion', 'Angharad', 'Lowri', 'Morwen', 'Nesta'],
    minorHouses: ['Mistle', 'Fairhollow', 'Glynne', 'Bryn', 'Pennant', 'Rhys', 'Afon'],
    ships: ['Greenholm', 'Oaken Heart', 'Summer Rain', 'Barley Queen', 'Kind Wind'],
  },
};
