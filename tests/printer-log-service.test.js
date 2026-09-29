const { parsePrinterLog } = require('../src/services/printerLogService');

function sample(jobName = 'Document, version finale', jobId = '12') {
  return [
    '"Discrimination code","Format version","Charset"',
    '"EA","01.00","UTF-8"',
    '"MODEL","SERIAL","VERSION","DATE","TIME","PRINTER NAME"',
    '"ComColor FT5430","35331082","1.0","2022/05/01","00:00:00","RISO PROFS C1"',
    '"Job kind","Job ID","Job name","Owner name","Start job","End job","Job status1","Color","Duplex printing","Output volume","Print count"',
    `"Copy","${jobId}","${jobName}","Alice","2022-05-06 15:14:58","2022-05-06 15:15:05","Suspend","Black","Duplex","3","0"`
  ].join('\r\n');
}

test('lit le préambule, les champs cités et préserve un compteur réel à zéro', async () => {
  const parsed = await parsePrinterLog(Buffer.from(sample()));
  expect(parsed.printer).toEqual({ serial: '35331082', name: 'RISO PROFS C1', model: 'ComColor FT5430' });
  expect(parsed.jobs).toHaveLength(1);
  expect(parsed.jobs[0]).toMatchObject({ jobKind: 'Copy', jobName: 'Document, version finale', ownerName: 'Alice', status: 'Suspend', outputVolume: 3, printCount: 0 });
});

test('rejette un doublon dans le même fichier', async () => {
  const line = sample().split('\r\n').at(-1);
  await expect(parsePrinterLog(Buffer.from(sample() + '\r\n' + line))).rejects.toThrow('opération en double');
});

test('rejette un fichier qui ne respecte pas le format RISO', async () => {
  await expect(parsePrinterLog(Buffer.from('name,copies\nAlice,3'))).rejects.toThrow('Format de journal RISO non reconnu');
});
