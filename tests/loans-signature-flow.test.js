const fs=require('fs');
const vm=require('vm');
const script=fs.readFileSync(require('path').join(__dirname,'../public/js/loans.js'),'utf8');
function extract(name) {
  const match=script.match(new RegExp('(?:async )?function '+name+'\\([^]*?(?=\\n(?:async )?function |\\n(?:let|const|document\\.)|$)'));
  if(!match)throw Error('Missing function '+name);
  return match[0];
}
function harness(role='ADMIN') {
  const nodes=new Map();
  const get=id=>{
    if(!nodes.has(id)){
      const classes=new Set(['hidden']);
      nodes.set(id,{ value:'',textContent:'',innerHTML:'',disabled:false,checked:false,
        classList:{add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),contains:n=>classes.has(n),toggle:(n,force)=>{const add=force===undefined?!classes.has(n):force;if(add)classes.add(n);else classes.delete(n);}},
        removeAttribute(name){delete this[name];}
      });
    }
    return nodes.get(id);
  };
  const loan={ id:'loan-1',resourceId:'free-loan',requesterName:'Emprunteur',requesterEmail:'borrower@example.com',status:'APPROVED',startAt:null,endAt:null,contractSignatureRequest:null };
  const context={ currentUser:{role},loanReservations:[],mobileSignatureLoanId:null,mobileSignatureCandidates:[],mobileSignatureRequestVersion:0,
    reservationUpdatesInFlight:new Set(),reservationEquipmentSelection:new Set(),FREE_LOAN_RESOURCE_ID:'free-loan',
    document:{getElementById:get,querySelectorAll:()=>[],body:{contains:()=>true}},
    api:{get:jest.fn(),post:jest.fn(),patch:jest.fn()},loadReservations:jest.fn().mockResolvedValue(),showToast:jest.fn(),closeReservationModal:jest.fn(),
    escapeHtml:value=>String(value),formatDateTime:value=>String(value),Date,console
  };
  context.api.post.mockImplementation(async url=>url==='/loans/reservations'?{count:1,reservations:[{...loan}]}:{signUrl:'https://example.test/sign?token='+url,qrCode:'data:image/png;base64,qr',expiresAt:'2099-01-01',signatureRequest:{id:'sig',status:'PENDING'}});
  context.api.get.mockResolvedValue({signUrl:'https://example.test/reused',qrCode:'data:image/png;base64,qr',expiresAt:'2099-01-01'});
  context.api.patch.mockResolvedValue({...loan});
  ['formatReservationPeriod','offerReservationSignatures','openSelectedSignatureLink','closeSignatureLinkModal','openMobileSignatureLink','updateReservationStatus'].forEach(name=>vm.runInNewContext(extract(name),context));
  const marker="document.getElementById('reservation-form').addEventListener('submit', ";
  const start=script.indexOf(marker)+marker.length;
  const end=script.indexOf('\n});',start)+2;
  vm.runInNewContext('this.submitReservation='+script.slice(start,end)+';',context);
  const values={'resv-resource':'free-loan','resv-name':'Emprunteur','resv-email':'borrower@example.com','resv-units':'1','resv-status':'APPROVED','resv-recurrence-type':'none'};
  Object.entries(values).forEach(([id,value])=>get(id).value=value);
  get('resv-no-period').checked=true;
  return {context,get,loan};
}
describe('signature choices immediately after loan validation',()=>{
  it('opens the signature link after creating a loan without sending an email automatically',async()=>{
    const {context:c,get}=harness();
    await c.submitReservation({preventDefault(){}});
    expect(c.api.post.mock.calls.map(call=>call[0])).toEqual(['/loans/reservations','/loans/reservations/loan-1/contract-signature']);
    expect(get('signature-link-modal').classList.contains('hidden')).toBe(false);
    expect(get('signature-link-url').value).toContain('https://example.test/sign');
    expect(get('signature-link-email').disabled).toBe(false);
    expect(c.closeReservationModal).toHaveBeenCalled();
  });
  it('offers the signature after saving changes to an unsigned loan',async()=>{
    const {context:c,get}=harness();get('resv-id').value='loan-1';
    await c.submitReservation({preventDefault(){}});
    expect(c.api.patch).toHaveBeenCalled();
    expect(get('signature-link-modal').classList.contains('hidden')).toBe(false);
  });
  it('offers the signature when approving a pending reservation',async()=>{
    const {context:c,get}=harness();
    await c.updateReservationStatus('loan-1','APPROVED');
    expect(get('signature-link-modal').classList.contains('hidden')).toBe(false);
  });
  it('never generates a borrower signature while validating a return',async()=>{
    const {context:c,get}=harness();
    await c.updateReservationStatus('loan-1','RETURNED');
    expect(c.api.post.mock.calls.map(call=>call[0])).toEqual(['/loans/reservations/loan-1/approve-return']);
    expect(get('signature-link-modal').classList.contains('hidden')).toBe(true);
  });
  it('does not offer new signatures to technicians or for already signed documents',async()=>{
    const {context:c,loan}=harness('TECH');await c.offerReservationSignatures(loan);
    expect(c.api.post).not.toHaveBeenCalled();
    c.currentUser.role='ADMIN';
    await c.offerReservationSignatures({...loan,contractSignatureRequest:{status:'SIGNED'}});
    await c.offerReservationSignatures({...loan,contractSignatureRequest:{status:'PENDING',verificationMethod:'EMAIL_OTP'}});
    expect(c.api.post).not.toHaveBeenCalled();
  });
  it('offers each recurring loan and reuses links that were generated already',async()=>{
    const {context:c,get,loan}=harness();
    await c.offerReservationSignatures([{...loan},{...loan,id:'loan-2'}]);
    expect(get('signature-link-reservations-row').classList.contains('hidden')).toBe(false);
    get('signature-link-reservations').value='loan-2';await c.openSelectedSignatureLink();
    get('signature-link-reservations').value='loan-1';await c.openSelectedSignatureLink();
    expect(c.api.post).toHaveBeenCalledTimes(2);
    expect(c.api.get).toHaveBeenCalledWith('/loans/reservations/loan-1/signature-link');
  });
  it('does not lose the saved loan if preparing its signature link fails',async()=>{
    const {context:c}=harness();
    c.api.post.mockImplementation(async url=>{if(url==='/loans/reservations')return {count:1,reservations:[{id:'loan-1',status:'APPROVED'}]};throw Error('Signature indisponible');});
    await c.submitReservation({preventDefault(){}});
    expect(c.closeReservationModal).toHaveBeenCalled();
    expect(c.showToast).toHaveBeenCalledWith('Signature indisponible','error');
  });
});
